import type { Prisma, PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { CapitalError, ensureReferences, locked, writeOperation } from './repository.js'
import { withCapitalOwner } from './connections.js'
import { fetchOkxHistory, mapOkxRecord, okxConfigured, okxExternalId, okxRecordRevision } from './okx.js'
import { configuredOkxWalletAddress, fetchOkxWeb3History, mapOkxWeb3Record, okxWeb3Chains, okxWeb3Configured, okxWeb3ExternalId, okxWeb3RecordRevision, type OkxWeb3Transaction } from './okx-web3.js'
import type { NormalizedOperationInput, ReferenceData } from './shared/contracts.js'

export type SyncSource = 'okx_exchange' | 'okx_wallet'
export type SyncProgress = { phase: 'fetching' | 'importing'; source?: string; fetched: number; processed: number; total: number }
export type SyncStatus = { id: string; status: string; imported: number; error: string | null; startedAt: string; finishedAt: string | null; progress?: SyncProgress }
const leaseMs = 5 * 60 * 1000
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  const match = message.match(/OKX(?:_WEB3)?_(?:HTTP_)?\d+/)
  return match ? `Источник недоступен (${match[0]}). Повторите синхронизацию.` : 'Синхронизация не завершена. Проверьте подключение и повторите.'
}

export function createCapitalSync(prisma: PrismaClient) {
  const live = new Map<string, SyncProgress>()
  const tasks = new Map<string, Promise<void>>()
  const key = (owner: bigint, id: string) => `${owner}:${id}`
  async function status(userId: bigint, source: SyncSource, id?: string): Promise<SyncStatus | null> {
    await prisma.capitalSyncRun.updateMany({ where: { userId, source, status: 'running', heartbeatAt: { lt: new Date(Date.now() - leaseMs) } }, data: { status: 'interrupted', finishedAt: new Date(), error: 'Синхронизация прервана. Можно запустить повторно.' } })
    const row = await prisma.capitalSyncRun.findFirst({ where: { userId, source, ...(id ? { id } : {}) }, orderBy: { startedAt: 'desc' } })
    return row ? { id: row.id, status: row.status, imported: row.importedCount, error: row.error, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null, progress: live.get(key(userId, row.id)) } : null
  }
  async function applyRecord(userId: bigint, source: SyncSource, kind: string, raw: Record<string, unknown>, wallet: string | null) {
    const externalId = source === 'okx_exchange' ? okxExternalId(kind, raw) : okxWeb3ExternalId(raw as OkxWeb3Transaction)
    if (!externalId) return 0
    const revision = source === 'okx_exchange' ? okxRecordRevision(raw) : okxWeb3RecordRevision(raw as OkxWeb3Transaction)
    const mapped = source === 'okx_exchange' ? mapOkxRecord(kind, raw) : mapOkxWeb3Record(raw as OkxWeb3Transaction, wallet!)
    return locked(prisma, userId, async db => {
      const previous = await db.capitalExternalRecord.findUnique({ where: { userId_source_externalId: { userId, source, externalId } } })
      await db.capitalExternalRecord.upsert({ where: { userId_source_externalId: { userId, source, externalId } }, create: { userId, source, externalId, revision, kind, payload: raw as Prisma.InputJsonObject }, update: { revision, kind, payload: raw as Prisma.InputJsonObject, importedAt: new Date() } })
      if (mapped) {
        const references: ReferenceData = { assets: [], locations: [], networks: [] }
        for (const leg of mapped.legs) {
          const fraction = leg.amount.split('.')[1]?.length ?? 0
          references.assets.push({ id: leg.assetId, symbol: leg.assetId.toUpperCase(), name: leg.assetId.toUpperCase(), kind: leg.assetId === 'rub' ? 'fiat' : 'crypto', decimals: Math.max(fraction, ['usdt','usdc','usde'].includes(leg.assetId) ? 6 : ['btc','wbtc'].includes(leg.assetId) ? 8 : 18) })
        }
        if (source === 'okx_wallet' && okxWeb3Chains[kind]) references.networks.push(okxWeb3Chains[kind]!)
        await ensureReferences(db, userId)
        await ensureReferences(db, userId, references)
        // Network fees can have finer precision than default UI denominations.
        for (const asset of references.assets) await db.capitalAsset.updateMany({ where: { userId, id: asset.id, decimals: { lt: asset.decimals } }, data: { decimals: asset.decimals } })
        const existing = await db.capitalOperation.findUnique({ where: { userId_importKey: { userId, importKey: JSON.stringify([source, externalId]) } } })
        if (!existing) await writeOperation(db, userId, mapped, { internal: true, allowDuplicate: true })
        else if (existing.externalRevision !== revision) {
          // A changed external record never overwrites a user's corrected operation.
          await db.capitalOperation.update({ where: { userId_id: { userId, id: existing.id } }, data: { externalRevision: revision, ...(existing.status !== 'archived' ? { status: 'needs_review' } : {}), updatedAt: new Date() } })
          await db.capitalAuditEvent.create({ data: { userId, operationId: existing.id, action: 'external_changed', payload: { previousRevision: existing.externalRevision, revision, suggested: mapped } as unknown as Prisma.InputJsonObject } })
        }
      }
      return previous ? 0 : 1
    })
  }
  async function execute(userId: bigint, source: SyncSource, runId: string) {
    let imported = 0
    const runKey = key(userId, runId)
    const sourceId = source === 'okx_wallet' ? `okx_wallet:${configuredOkxWalletAddress()}` : source
    let leaseLost = false
    const heartbeat = setInterval(() => {
      void prisma.capitalSyncRun.updateMany({ where: { userId, id: runId, status: 'running' }, data: { heartbeatAt: new Date() } }).then(r => { if (!r.count) leaseLost = true }).catch(() => { leaseLost = true })
    }, 15000)
    try {
      const cursorRow = await prisma.capitalSyncSource.findUnique({ where: { userId_id: { userId, id: sourceId } } })
      let cursors: Record<string, string> = {}
      try { cursors = JSON.parse(cursorRow?.cursor || '{}') } catch { /* restart safely with deduplication */ }
      const counts = new Map<string, number>()
      const progress = (scope: string, fetched: number) => {
        counts.set(scope, fetched)
        live.set(runKey, { phase: 'fetching', source: scope, fetched: [...counts.values()].reduce((n, v) => n + v, 0), processed: 0, total: 0 })
      }
      const result = source === 'okx_exchange' ? await fetchOkxHistory(p => progress(p.kind, p.fetched), cursors) : await fetchOkxWeb3History(p => progress(p.chainIndex, p.fetched), cursors)
      const groups = Object.entries(result.history)
      const total = groups.reduce((n, [, rows]) => n + rows.length, 0)
      let processed = 0
      const wallet = configuredOkxWalletAddress()
      for (const [kind, rows] of groups) for (const raw of rows) {
        if (leaseLost) throw new Error('LEASE_LOST')
        imported += await applyRecord(userId, source, kind, raw, wallet)
        processed++
        live.set(runKey, { phase: 'importing', source: kind, fetched: total, processed, total })
        await prisma.capitalSyncRun.updateMany({ where: { userId, id: runId, status: 'running' }, data: { importedCount: imported, heartbeatAt: new Date() } })
      }
      if (result.errors.length) throw new Error(result.errors.join('; '))
      await locked(prisma, userId, async db => {
        const updated = await db.capitalSyncRun.updateMany({ where: { userId, id: runId, status: 'running' }, data: { status: 'completed', importedCount: imported, cursor: JSON.stringify(result.cursors), finishedAt: new Date() } })
        if (!updated.count) throw new Error('LEASE_LOST')
        await db.capitalSyncSource.update({ where: { userId_id: { userId, id: sourceId } }, data: { cursor: JSON.stringify(result.cursors), lastSuccessAt: new Date(), updatedAt: new Date() } })
      })
    } catch (error) {
      await prisma.capitalSyncRun.updateMany({ where: { userId, id: runId, status: 'running' }, data: { status: 'failed', error: safeError(error), importedCount: imported, finishedAt: new Date() } })
    } finally { clearInterval(heartbeat); live.delete(runKey) }
  }
  async function start(userId: bigint, source: SyncSource) {
    return withCapitalOwner(userId, async () => {
      if (!(source === 'okx_exchange' ? okxConfigured() : okxWeb3Configured())) throw new CapitalError(409, 'Подключение не настроено для вашего аккаунта')
      const sourceId = source === 'okx_wallet' ? `okx_wallet:${configuredOkxWalletAddress()}` : source
      const result = await locked(prisma, userId, async db => {
        await db.capitalSyncRun.updateMany({ where: { userId, source, status: 'running', heartbeatAt: { lt: new Date(Date.now() - leaseMs) } }, data: { status: 'interrupted', finishedAt: new Date(), error: 'Запуск прерван' } })
        const current = await db.capitalSyncRun.findFirst({ where: { userId, source, status: 'running' } })
        if (current) return { runId: current.id, alreadyRunning: true }
        await db.capitalSyncSource.upsert({ where: { userId_id: { userId, id: sourceId } }, create: { userId, id: sourceId, displayName: source === 'okx_exchange' ? 'OKX Exchange' : 'OKX Wallet' }, update: {} })
        const runId = randomUUID()
        await db.capitalSyncRun.create({ data: { userId, id: runId, source, status: 'running' } })
        return { runId, alreadyRunning: false }
      })
      if (!result.alreadyRunning) {
        const task = execute(userId, source, result.runId).catch(() => undefined).finally(() => tasks.delete(key(userId, result.runId)))
        tasks.set(key(userId, result.runId), task)
      }
      return result
    })
  }
  return { start, status, applyRecord, wait: () => Promise.all(tasks.values()) }
}
