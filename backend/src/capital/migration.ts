import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from 'decimal.js'
import { backupSchema, type BackupPayload } from './shared/backup.js'
import { allOperations, backupData, CapitalError, locked, reconciliation, restoreBackup } from './repository.js'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([,v]) => v !== undefined).map(([k,v]) => [k, canonical(v)]))
  return value
}
export const payloadDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')

function comparableOperation(row: BackupPayload['operations'][number]) {
  return {
    ...row,
    occurredAt: new Date(row.occurredAt).toISOString(),
    ...(row.createdAt ? { createdAt: new Date(row.createdAt).toISOString() } : {}),
    ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt).toISOString() } : {}),
    archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
    legs: row.legs.map((leg, position) => ({ ...leg, position,
      amount: new Decimal(leg.amount).toFixed(),
      fiatValue: leg.fiatValue ? new Decimal(leg.fiatValue).toFixed() : undefined,
      unitPrice: leg.unitPrice ? new Decimal(leg.unitPrice).toFixed() : undefined,
    })),
  }
}

/** Rehearsal executes the exact restore and reconciliation, then rolls back. */
export async function migrateCapital(prisma: PrismaClient, userId: bigint, raw: unknown, apply = false) {
  const payload = backupSchema.parse(raw)
  if (payload.operations.some(row => !row.id || !row.createdAt || !row.updatedAt || row.legs.some(leg => !leg.id))) throw new CapitalError(422, 'Для полного переноса нужны исходные ID и даты операций и проводок')
  const dryRun = Symbol('rollback verified rehearsal')
  let report: Record<string, unknown> | undefined
  try {
    await locked(prisma, userId, async db => {
      if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new CapitalError(404, 'Аккаунт назначения не найден')
      const before = await db.capitalOperation.count({ where: { userId } })
      const result = await restoreBackup(db, userId, payload)
      const actual = backupSchema.parse(JSON.parse(JSON.stringify(await backupData(db, userId))))
      if (payload.references) for (const name of ['assets', 'locations', 'networks'] as const) {
        const restored = new Map(actual.references![name].map(row => [row.id, row]))
        for (const row of payload.references[name]) if (payloadDigest(row) !== payloadDigest(restored.get(row.id))) throw new CapitalError(409, `Сверка справочника ${name} не совпала; перенос отменён`)
      }
      const actualById = new Map(actual.operations.map(row => [row.id, row]))
      for (const row of payload.operations) {
        const restored = actualById.get(row.id)
        if (!restored || payloadDigest(comparableOperation(row)) !== payloadDigest(comparableOperation(restored))) throw new CapitalError(409, `Сверка операции ${row.id} не совпала; перенос отменён`)
      }
      for (const name of ['auditEvents','syncSources','syncRuns','externalRecords'] as const) {
        const restored = new Map((actual[name] ?? []).map(row => [row.id, row]))
        for (const row of payload[name] ?? []) {
          const target = restored.get(row.id)
          if (!target) throw new CapitalError(409, `Не перенесена запись ${name}`)
          // Running jobs become interrupted; other source metadata must survive verbatim.
          const expected = name === 'syncRuns' && 'status' in row && row.status === 'running' ? { ...row, status: 'interrupted', error: 'Импортировано из резервной копии; запустите синхронизацию заново', finishedAt: 'finishedAt' in target ? target.finishedAt : null } : row
          if (payloadDigest(expected) !== payloadDigest(target)) throw new CapitalError(409, `Сверка ${name} не совпала; перенос отменён`)
        }
      }
      const sourceIds = new Set(payload.operations.map(row => row.id))
      const migrated = (await allOperations(db, userId)).filter(row => sourceIds.has(row.id))
      report = { mode: apply ? 'applied' : 'dry-run-rolled-back', ownerId: String(userId), digest: payloadDigest(payload), before, imported: result.imported, skipped: result.skipped, reconciliation: reconciliation(migrated), metadata: Object.fromEntries(['auditEvents','syncSources','syncRuns','externalRecords'].map(name => [name, (payload[name as keyof BackupPayload] as unknown[] | undefined)?.length ?? 0])) }
      if (!apply) throw dryRun
    })
  } catch (error) { if (error !== dryRun) throw error }
  return report!
}
