import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from 'decimal.js'
import { calculatePortfolio } from './shared/domain.js'
import { operationInputSchema, validateOperationReferences, validateTxHash, type NormalizedOperationInput, type Operation, type OperationFilters, type ReferenceData } from './shared/contracts.js'
import { backupSchema, type BackupPayload, type RestorableOperation } from './shared/backup.js'
import { defaultReferences } from './shared/references.js'

export class CapitalError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message) }
}
export type CapitalDb = Prisma.TransactionClient
const operationInclude = { legs: { orderBy: { position: 'asc' as const } } }
type StoredOperation = Prisma.CapitalOperationGetPayload<{ include: typeof operationInclude }>
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const owned = (userId: bigint, id: string) => ({ userId_id: { userId, id } })
const chronological = [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const

export function serializeOperation(row: StoredOperation): Operation {
  const { userId: _owner, importKey: _import, chainKey: _chain, legs, ...data } = row
  return {
    ...data, type: data.type as Operation['type'], status: data.status as Operation['status'], source: data.source as Operation['source'],
    occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null,
    externalId: row.externalId ?? undefined, externalRevision: row.externalRevision ?? undefined,
    locationFromId: row.locationFromId ?? undefined, locationToId: row.locationToId ?? undefined, networkId: row.networkId ?? undefined,
    txHash: row.txHash ?? undefined, logIndex: row.logIndex ?? undefined, destinationAddress: row.destinationAddress ?? undefined, note: row.note ?? undefined,
    legs: legs.map(({ userId: _u, operationId: _o, ...leg }) => ({ ...leg, direction: leg.direction as 'in' | 'out' | 'fee', locationId: leg.locationId ?? undefined, amount: leg.amount.toFixed(), fiatValue: leg.fiatValue?.toFixed() ?? null, unitPrice: leg.unitPrice?.toFixed() ?? null })),
  }
}

export async function ensureReferences(db: CapitalDb, userId: bigint, references = defaultReferences) {
  await db.capitalAsset.createMany({ data: references.assets.map(row => ({ ...row, userId })), skipDuplicates: true })
  await db.capitalLocation.createMany({ data: references.locations.map(row => ({ ...row, userId })), skipDuplicates: true })
  await db.capitalNetwork.createMany({ data: references.networks.map(row => ({ ...row, userId })), skipDuplicates: true })
}
export async function getReferences(db: CapitalDb, userId: bigint): Promise<ReferenceData> {
  const [assets, locations, networks] = await Promise.all([
    db.capitalAsset.findMany({ where: { userId }, orderBy: [{ kind: 'asc' }, { symbol: 'asc' }] }),
    db.capitalLocation.findMany({ where: { userId }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
    db.capitalNetwork.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
  ])
  return { assets: assets.map(({ userId: _, ...row }) => ({ ...row, kind: row.kind as 'fiat' | 'crypto' })), locations: locations.map(({ userId: _, ...row }) => ({ ...row, kind: row.kind as 'fiat' | 'exchange' | 'wallet' })), networks: networks.map(({ userId: _, ...row }) => row) }
}

export async function validateInput(db: CapitalDb, userId: bigint, input: NormalizedOperationInput) {
  const refs = await getReferences(db, userId)
  const issues = validateOperationReferences(input, refs)
  const txIssue = validateTxHash(input.txHash, refs.networks.find(n => n.id === input.networkId))
  if (txIssue) issues.push(txIssue)
  try { new Intl.DateTimeFormat('ru', { timeZone: input.timezone }) } catch { issues.push('Некорректный часовой пояс') }
  for (const leg of input.legs) {
    for (const [field, scale] of [['amount', 18], ['fiatValue', 8], ['unitPrice', 18]] as const) {
      const value = leg[field]
      if (!value) continue
      const [integer, fraction = ''] = value.split('.')
      if (integer.replace(/^0+/, '').length > 38 - scale || fraction.length > scale) issues.push('Сумма превышает поддерживаемую точность')
    }
  }
  if (issues.length) throw new CapitalError(422, [...new Set(issues)].join('. '))
}

export async function listOperations(db: CapitalDb, userId: bigint, filters: OperationFilters = {}) {
  const AND: Prisma.CapitalOperationWhereInput[] = [{ userId }]
  if (filters.status !== 'archived') AND.push({ archivedAt: null })
  for (const key of ['type', 'status', 'source', 'networkId'] as const) if (filters[key]) AND.push({ [key]: filters[key] })
  if (filters.locationId) AND.push({ OR: [{ locationFromId: filters.locationId }, { locationToId: filters.locationId }] })
  if (filters.assetId) AND.push({ legs: { some: { userId, assetId: filters.assetId } } })
  if (filters.dateFrom) AND.push({ occurredAt: { gte: new Date(filters.dateFrom) } })
  if (filters.dateTo) AND.push({ occurredAt: { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } })
  if (filters.search) {
    const contains = { contains: filters.search, mode: 'insensitive' as const }
    AND.push({ OR: [
      ...['id', 'externalId', 'txHash', 'destinationAddress', 'note'].map(key => ({ [key]: contains })),
      { legs: { some: { userId, asset: { OR: [{ symbol: contains }, { name: contains }] } } } },
      { locationFrom: { name: contains } }, { locationTo: { name: contains } },
    ] })
  }
  const page = filters.page ?? 1, pageSize = filters.pageSize ?? 20
  const order = filters.sort === 'oldest' ? 'asc' : 'desc'
  const where = { AND }
  const [rows, total, source] = await Promise.all([
    db.capitalOperation.findMany({ where, include: operationInclude, orderBy: [{ occurredAt: order }, { createdAt: order }, { id: order }], take: pageSize, skip: (page - 1) * pageSize }),
    db.capitalOperation.count({ where }),
    db.capitalSyncSource.findFirst({ where: { userId, lastSuccessAt: { not: null } }, orderBy: { lastSuccessAt: 'desc' } }),
  ])
  return { items: rows.map(serializeOperation), total, page, pageSize, lastSyncAt: source?.lastSuccessAt?.toISOString() ?? null }
}
export async function allOperations(db: CapitalDb, userId: bigint, completedOnly = false) {
  return (await db.capitalOperation.findMany({ where: { userId, ...(completedOnly ? { status: 'completed', archivedAt: null } : {}) }, include: operationInclude, orderBy: [...chronological] })).map(serializeOperation)
}

async function duplicate(db: CapitalDb, userId: bigint, input: NormalizedOperationInput, excludedId?: string) {
  if (input.source !== 'manual') return false
  const candidates = await db.capitalOperation.findMany({
    where: { userId, archivedAt: null, ...(excludedId ? { id: { not: excludedId } } : {}), OR: [
      { type: input.type, source: 'manual', occurredAt: new Date(input.occurredAt), locationFromId: input.locationFromId || null, locationToId: input.locationToId || null },
      ...(input.externalId ? [{ externalId: input.externalId }] : []),
      ...(input.txHash && input.networkId ? [{ txHash: input.txHash, networkId: input.networkId }] : []),
    ] }, include: operationInclude,
  })
  const signature = (legs: Array<{ direction: string; assetId: string; locationId?: string | null; amount: string }>) => legs.map(l => `${l.direction}:${l.assetId}:${l.locationId || ''}:${new Decimal(l.amount).toFixed()}`).sort().join('|')
  return candidates.some(row =>
    (input.externalId && row.externalId === input.externalId) || (input.txHash && row.txHash === input.txHash && row.networkId === input.networkId) || signature(serializeOperation(row).legs) === signature(input.legs),
  )
}

export async function writeOperation(db: CapitalDb, userId: bigint, input: NormalizedOperationInput, options: { id?: string; allowDuplicate?: boolean; restore?: RestorableOperation; internal?: boolean; confirmReview?: boolean; baseUpdatedAt?: string } = {}) {
  const existing = options.id ? await db.capitalOperation.findUnique({ where: owned(userId, options.id), include: operationInclude }) : null
  if (options.id && !existing && !options.restore) throw new CapitalError(404, 'Операция не найдена')
  if (existing && !options.internal) {
    if (options.baseUpdatedAt && existing.updatedAt.toISOString() !== options.baseUpdatedAt) throw new CapitalError(409, 'Операция уже изменена. Обновите журнал и повторите изменение.', 'CONFLICT')
    if (existing.status === 'archived') throw new CapitalError(409, 'Операция находится в архиве')
    if ((existing.status === 'needs_review' || (existing.source !== 'manual' && existing.status !== 'completed')) && input.status === 'completed' && !options.confirmReview) throw new CapitalError(422, 'Подтвердите проверку импортированной операции', 'REVIEW_REQUIRED')
    input = { ...input, source: existing.source as Operation['source'], ...(existing.source !== 'manual' ? { externalId: existing.externalId ?? undefined, externalRevision: existing.externalRevision ?? undefined } : {}) }
  }
  await validateInput(db, userId, input)
  if (!options.allowDuplicate && !options.restore && await duplicate(db, userId, input, options.id)) throw new CapitalError(409, 'Похожая операция уже существует', 'POSSIBLE_DUPLICATE')
  const id = options.id ?? options.restore?.id ?? randomUUID()
  const now = new Date()
  const sourceKey = input.source !== 'manual' && input.externalId ? JSON.stringify([input.source, input.externalId]) : null
  const chainKey = input.source !== 'manual' && input.networkId && input.txHash && input.logIndex !== undefined ? JSON.stringify([input.source, input.networkId, input.txHash, input.logIndex]) : null
  const data = {
    type: input.type, occurredAt: new Date(input.occurredAt), timezone: input.timezone, status: input.status, source: input.source,
    externalId: input.externalId || null, externalRevision: input.externalRevision || null, importKey: sourceKey, chainKey,
    locationFromId: input.locationFromId || null, locationToId: input.locationToId || null, networkId: input.networkId || null,
    txHash: input.txHash || null, logIndex: input.logIndex ?? null, destinationAddress: input.destinationAddress || null, note: input.note || null,
    updatedAt: options.restore?.updatedAt ? new Date(options.restore.updatedAt) : now,
    archivedAt: input.status === 'archived' ? new Date(options.restore?.archivedAt || now) : null,
  }
  if (existing) {
    await db.capitalOperation.update({ where: owned(userId, id), data })
    await db.capitalLeg.deleteMany({ where: { userId, operationId: id } })
  } else {
    await db.capitalOperation.create({ data: { ...data, userId, id, createdAt: options.restore?.createdAt ? new Date(options.restore.createdAt) : now } })
  }
  await db.capitalLeg.createMany({ data: input.legs.map((leg, position) => ({
    userId, operationId: id, id: options.restore?.legs[position]?.id ?? existing?.legs.find(l => l.position === position)?.id ?? randomUUID(),
    direction: leg.direction, assetId: leg.assetId, locationId: leg.locationId || null, amount: leg.amount, fiatValue: leg.fiatValue || null, unitPrice: leg.unitPrice || null, position,
  })) })
  await db.capitalAuditEvent.create({ data: { userId, operationId: id, action: options.restore ? 'restored' : existing ? 'updated' : 'created', payload: json({ previous: existing ? serializeOperation(existing) : null, next: input }) } })
  return serializeOperation((await db.capitalOperation.findUniqueOrThrow({ where: owned(userId, id), include: operationInclude })))
}

export async function archiveOperation(db: CapitalDb, userId: bigint, id: string) {
  const row = await db.capitalOperation.findUnique({ where: owned(userId, id) })
  if (!row) throw new CapitalError(404, 'Операция не найдена')
  if (row.archivedAt) return
  await db.capitalOperation.update({ where: owned(userId, id), data: { status: 'archived', archivedAt: new Date(), updatedAt: new Date() } })
  await db.capitalAuditEvent.create({ data: { userId, operationId: id, action: 'archived', payload: { previousStatus: row.status } } })
}

export async function backupData(db: CapitalDb, userId: bigint) {
  const [operations, references, settings, auditEvents, syncSources, syncRuns, externalRecords] = await Promise.all([
    allOperations(db, userId), getReferences(db, userId), db.capitalSetting.findMany({ where: { userId } }),
    db.capitalAuditEvent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }), db.capitalSyncSource.findMany({ where: { userId } }),
    db.capitalSyncRun.findMany({ where: { userId } }), db.capitalExternalRecord.findMany({ where: { userId } }),
  ])
  const values = Object.fromEntries(settings.map(s => [s.key, s.value]))
  const withoutOwner = <T extends { userId: bigint }>(rows: T[]) => rows.map(({ userId: _, ...row }) => row)
  return {
    schemaVersion: 2, exportedAt: new Date().toISOString(), references, operations,
    settings: { baseCurrency: 'RUB', timezone: values.timezone ?? 'Asia/Bangkok', ...(values.number_format ? { numberFormat: values.number_format } : {}) },
    auditEvents: withoutOwner(auditEvents), syncSources: withoutOwner(syncSources), syncRuns: withoutOwner(syncRuns).map(({ heartbeatAt: _, ...row }) => row), externalRecords: withoutOwner(externalRecords),
  }
}

export function reconciliation(operations: Operation[]) {
  const counts: Record<string, number> = {}
  for (const row of operations) counts[`${row.type}:${row.status}`] = (counts[`${row.type}:${row.status}`] ?? 0) + 1
  return { operations: operations.length, legs: operations.reduce((n, r) => n + r.legs.length, 0), counts, portfolio: calculatePortfolio(operations) }
}

export async function restoreBackup(db: CapitalDb, userId: bigint, raw: unknown) {
  const payload = backupSchema.parse(raw)
  // Restores may add references, but must never silently redefine assets already in use.
  if (payload.references) {
    for (const [rows, kind] of [[payload.references.assets, 'asset'], [payload.references.locations, 'location'], [payload.references.networks, 'network']] as const) {
      const seen = new Set<string>()
      for (const row of rows) {
        if (seen.has(row.id)) throw new CapitalError(422, 'Повтор идентификатора в справочнике')
        seen.add(row.id)
      }
      void kind
    }
    const existingRefs = await getReferences(db, userId)
    for (const asset of payload.references.assets) {
      const prev = existingRefs.assets.find(a => a.id === asset.id)
      if (prev && (prev.decimals !== asset.decimals || prev.kind !== asset.kind || prev.symbol !== asset.symbol)) throw new CapitalError(409, `Несовместимый справочник актива ${asset.id}`)
    }
    for (const location of payload.references.locations) {
      const prev = existingRefs.locations.find(row => row.id === location.id)
      if (prev && prev.kind !== location.kind) throw new CapitalError(409, `Несовместимый справочник площадки ${location.id}`)
    }
    for (const network of payload.references.networks) {
      const prev = existingRefs.networks.find(row => row.id === network.id)
      if (prev && prev.code !== network.code) throw new CapitalError(409, `Несовместимый справочник сети ${network.id}`)
    }
    await ensureReferences(db, userId, payload.references)
  }
  await ensureReferences(db, userId)
  let imported = 0, skipped = 0
  const seenIds = new Set<string>()
  for (const operation of payload.operations) {
    const id = operation.id ?? createHash('sha256').update(JSON.stringify(operation)).digest('hex')
    if (seenIds.has(id)) throw new CapitalError(422, 'Повтор идентификатора операции в файле')
    seenIds.add(id)
    const input = operationInputSchema.parse(operation)
    await validateInput(db, userId, input)
    const existing = await db.capitalOperation.findFirst({ where: { userId, OR: [{ id }, ...(input.source !== 'manual' && input.externalId ? [{ importKey: JSON.stringify([input.source, input.externalId]) }] : [])] } })
    if (existing) {
      if (existing.id !== id) throw new CapitalError(409, 'Внешняя операция уже существует с другим ID; восстановление отменено')
      skipped++; continue
    }
    await writeOperation(db, userId, input, { id, restore: operation, internal: true, allowDuplicate: true })
    imported++
  }
  for (const [key, value] of Object.entries({ base_currency: payload.settings?.baseCurrency, timezone: payload.settings?.timezone, number_format: payload.settings?.numberFormat })) {
    if (value !== undefined) await db.capitalSetting.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, value }, update: { value, updatedAt: new Date() } })
  }
  await restoreMetadata(db, userId, payload)
  return { imported, skipped, reconciliation: reconciliation(await allOperations(db, userId)) }
}

async function restoreMetadata(db: CapitalDb, userId: bigint, payload: BackupPayload) {
  for (const event of payload.auditEvents ?? []) {
    if (event.operationId && !await db.capitalOperation.findUnique({ where: owned(userId, event.operationId), select: { id: true } })) throw new CapitalError(422, 'В истории изменений отсутствует связанная операция')
    await db.capitalAuditEvent.createMany({ data: [{ ...event, userId, payload: json(event.payload) }], skipDuplicates: true })
  }
  for (const source of payload.syncSources ?? []) await db.capitalSyncSource.createMany({ data: [{ ...source, userId }], skipDuplicates: true })
  for (const run of payload.syncRuns ?? []) await db.capitalSyncRun.createMany({ data: [{ ...run, userId, status: run.status === 'running' ? 'interrupted' : run.status, ...(run.status === 'running' ? { error: 'Импортировано из резервной копии; запустите синхронизацию заново', finishedAt: new Date() } : {}) }], skipDuplicates: true })
  for (const record of payload.externalRecords ?? []) await db.capitalExternalRecord.createMany({ data: [{ ...record, userId, payload: json(record.payload) }], skipDuplicates: true })
}

export const locked = <T>(prisma: PrismaClient, userId: bigint, action: (db: CapitalDb) => Promise<T>) => prisma.$transaction(async db => {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'capital:' + userId}, 0))::text`
  return action(db)
}, { timeout: 120000, maxWait: 15000 })
