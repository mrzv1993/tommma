import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { PrismaClient } from '@prisma/client'
import { migrateCapital } from './migration.js'
import { randomUUID } from 'node:crypto'
import { registerCapitalRoutes } from './routes.js'
import { createCapitalSync } from './sync.js'
import { defaultReferences } from './shared/references.js'
import { calculatePortfolio } from './shared/domain.js'

const url = process.env.CAPITAL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !target.pathname.includes('test')) throw new Error('Capital integration tests require a local disposable test database')
}
const suite = url ? describe : describe.skip
suite('capital real PostgreSQL ownership, financial data and restore', { timeout: 30000 }, () => {
  const db = new PrismaClient({ datasources: { db: { url } } })
  const app = Fastify()
  let a: bigint, b: bigint
  const sync = createCapitalSync(db)
  const req = (user: bigint | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown) => app.inject({ method, url: `/capital${path}`, headers: user ? { authorization: `Bearer ${user}` } : {}, ...(payload === undefined ? {} : { payload: payload as object }) })
  const purchase = (note = 'test') => ({ type: 'purchase', status: 'completed', source: 'manual', occurredAt: '2026-09-01T10:00:00.000Z', timezone: 'Asia/Bangkok', locationToId: 'okx', note, legs: [{ direction: 'out', assetId: 'rub', amount: '8000' }, { direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx' }] })
  const create = async (user = a, note = 'test') => { const r = await req(user, 'POST', '/operations', purchase(note)); expect(r.statusCode, r.body).toBe(201); return r.json() }
  beforeAll(async () => {
    registerCapitalRoutes(app, db, async request => { const value = request.headers.authorization?.replace('Bearer ', ''); return value && /^\d+$/.test(value) ? BigInt(value) : null }, new Set(['http://localhost']))
    await app.ready()
  })
  beforeEach(async () => {
    const tag = randomUUID().slice(0, 8)
    a = (await db.user.create({ data: { nickname: `cap_a_${tag}`, email: `cap_a_${tag}@example.test`, passwordHash: 'not-a-real-password' } })).id
    b = (await db.user.create({ data: { nickname: `cap_b_${tag}`, email: `cap_b_${tag}@example.test`, passwordHash: 'not-a-real-password' } })).id
  })
  afterAll(async () => { await sync.wait(); await app.close(); await db.$disconnect() })

  it('requires a current user and rejects foreign origins even with a session', async () => {
    expect((await req(null, 'GET', '/operations')).statusCode).toBe(401)
    expect((await req(9223372036854775807n, 'GET', '/operations')).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/capital/operations', headers: { authorization: `Bearer ${a}`, origin: 'https://evil.example' }, payload: purchase() })).statusCode).toBe(403)
  })
  it('scopes list/detail/write/archive/audit/backup and portfolio to the owner', async () => {
    const row = await create()
    expect((await req(b, 'GET', '/operations')).json().total).toBe(0)
    expect((await req(b, 'GET', `/operations/${row.id}`)).statusCode).toBe(404)
    expect((await req(b, 'PUT', `/operations/${row.id}`, purchase('intrusion'))).statusCode).toBe(404)
    expect((await req(b, 'DELETE', `/operations/${row.id}`)).statusCode).toBe(404)
    expect((await req(b, 'GET', `/audit?operationId=${row.id}`)).json().items).toEqual([])
    expect((await req(b, 'GET', '/backup')).json().operations).toEqual([])
    expect((await req(b, 'GET', '/portfolio')).json().investedRub).toBe('0')
    expect((await req(a, 'GET', '/portfolio')).json().investedRub).toBe('8000')
    expect((await req(a, 'GET', '/operations')).headers['cache-control']).toBe('no-store')
    expect(JSON.stringify((await req(a, 'GET', '/backup')).json())).not.toContain('userId')
  })
  it('warns about a manual duplicate and preserves deliberate duplicates', async () => {
    await create()
    const duplicate = await req(a, 'POST', '/operations', purchase())
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().code).toBe('POSSIBLE_DUPLICATE')
    expect((await req(a, 'POST', '/operations?allowDuplicate=true', purchase())).statusCode).toBe(201)
    expect((await req(a, 'GET', '/operations')).json().total).toBe(2)
  })
  it('updates and archives with deterministic financial recalculation and conflict detection', async () => {
    const row = await create()
    const update = await req(a, 'PUT', `/operations/${row.id}`, { ...purchase(), baseUpdatedAt: row.updatedAt, legs: [{ direction: 'out', assetId: 'rub', amount: '9000' }, { direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx' }] })
    expect(update.statusCode, update.body).toBe(200)
    expect((await req(a, 'GET', '/portfolio')).json().investedRub).toBe('9000')
    expect((await req(a, 'PUT', `/operations/${row.id}`, { ...purchase(), baseUpdatedAt: row.updatedAt })).statusCode).toBe(409)
    expect((await req(a, 'DELETE', `/operations/${row.id}`)).statusCode).toBe(204)
    expect((await req(a, 'GET', '/portfolio')).json().investedRub).toBe('0')
    expect((await req(a, 'GET', '/operations')).json().total).toBe(0)
    expect((await req(a, 'GET', '/operations?status=archived')).json().total).toBe(1)
    expect((await req(a, 'GET', '/audit')).json().items.map((x: { action: string }) => x.action)).toContain('archived')
  })
  it('restores a v1 backup with nullable leg prices and the same IDs independently for two users', async () => {
    const row = await create()
    const backup = (await req(a, 'GET', '/backup')).json()
    const legacy = { schemaVersion: 1, references: backup.references, operations: backup.operations.map((operation: any) => ({ ...operation, legs: operation.legs.map((leg: any) => ({ ...leg, amount: leg.amount + '.000000000000000000' })) })), settings: backup.settings, userId: String(a) }
    const first = await req(b, 'POST', '/backup/restore', legacy)
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toMatchObject({ imported: 1, skipped: 0 })
    const restored = (await req(b, 'GET', `/operations/${row.id}`)).json()
    expect(restored).toEqual(row)
    expect((await req(b, 'POST', '/backup/restore', legacy)).json()).toMatchObject({ imported: 0, skipped: 1 })
    expect((await req(b, 'GET', '/portfolio')).json()).toEqual(calculatePortfolio(backup.operations))
    expect((await req(b, 'POST', '/backup/restore', (await req(b, 'GET', '/backup')).json())).statusCode).toBe(200)
  })
  it('rolls back the entire restore including references when any operation is invalid', async () => {
    const one = { ...purchase(), id: randomUUID() }
    const invalid = { ...purchase(), id: randomUUID(), locationToId: 'missing' }
    const r = await req(a, 'POST', '/backup/restore', { schemaVersion: 1, references: { ...defaultReferences, locations: [...defaultReferences.locations, { id: 'new-place', kind: 'wallet', name: 'New' }] }, operations: [one, invalid] })
    expect(r.statusCode, r.body).toBe(422)
    expect(await db.capitalOperation.count({ where: { userId: a } })).toBe(0)
    expect(await db.capitalLocation.count({ where: { userId: a } })).toBe(0)
  })
  it('rejects foreign references and amounts that the database would round', async () => {
    await req(a, 'GET', '/references')
    await req(b, 'GET', '/references')
    await db.capitalLocation.create({ data: { userId: b, id: 'private-place', name: 'Private', kind: 'wallet' } })
    expect((await req(a, 'POST', '/operations', { ...purchase(), locationToId: 'private-place' })).statusCode).toBe(422)
    const r = await req(a, 'POST', '/operations', { ...purchase(), legs: [{ direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000.123456789' }, { direction: 'in', assetId: 'usdt', amount: '100' }] })
    expect(r.statusCode).toBe(422)
  })
  it('retains review status unless the owner explicitly confirms the imported operation', async () => {
    const id = randomUUID()
    const r = await req(a, 'POST', '/backup/restore', { references: defaultReferences, operations: [{ ...purchase(), id, source: 'okx_exchange', externalId: 'import-1', status: 'needs_review' }] })
    expect(r.statusCode, r.body).toBe(200)
    const row = (await req(a, 'GET', `/operations/${id}`)).json()
    const input = { ...row, legs: row.legs.map((leg: Record<string, unknown>) => ({ ...leg, fiatValue: undefined, unitPrice: undefined })) }
    expect((await req(a, 'PUT', `/operations/${id}`, { ...input, note: 'review later' })).json().status).toBe('needs_review')
    expect((await req(a, 'PUT', `/operations/${id}`, { ...input, status: 'completed' })).statusCode).toBe(422)
    expect((await req(a, 'PUT', `/operations/${id}?confirmReview=true`, { ...input, status: 'completed' })).statusCode).toBe(200)
    expect((await req(a, 'GET', '/portfolio')).json().investedRub).toBe('8000')
  })
  it('supports combined filters, search, both sort directions and full pagination', async () => {
    const operations = Array.from({ length: 23 }, (_, i) => ({ ...purchase(`note ${i}`), id: randomUUID(), occurredAt: `2026-09-${String(i+1).padStart(2,'0')}T10:00:00.000Z` }))
    expect((await req(a, 'POST', '/backup/restore', { references: defaultReferences, operations })).statusCode).toBe(200)
    const p1 = (await req(a, 'GET', '/operations?assetId=usdt&locationId=okx&type=purchase&status=completed&source=manual&sort=oldest')).json()
    expect(p1.total).toBe(23); expect(p1.items).toHaveLength(20); expect(p1.items[0].note).toBe('note 0')
    expect((await req(a, 'GET', '/operations?page=2')).json().items).toHaveLength(3)
    expect((await req(a, 'GET', '/operations?search=USDT&dateFrom=2026-09-21&dateTo=2026-09-23')).json().total).toBe(3)
    expect((await req(a, 'GET', '/operations?search=OKX')).json().total).toBe(23)
    expect((await req(b, 'GET', '/operations?search=USDT')).json().total).toBe(0)
  })
  it('isolates source records, deduplicates reimport and preserves user corrections', async () => {
    const raw = { depId: 'dep-test', ccy: 'USDT', amt: '10', chain: 'USDT-TRC20', state: '2', ts: '1700000000000' }
    await sync.applyRecord(a, 'okx_exchange', 'deposits', raw, null)
    await sync.applyRecord(b, 'okx_exchange', 'deposits', raw, null)
    const row = (await req(a, 'GET', '/operations')).json().items[0]
    await db.capitalOperation.update({ where: { userId_id: { userId: a, id: row.id } }, data: { status: 'completed', note: 'corrected by owner' } })
    await Promise.all([sync.applyRecord(a, 'okx_exchange', 'deposits', raw, null), sync.applyRecord(a, 'okx_exchange', 'deposits', raw, null)])
    expect((await req(a, 'GET', '/operations')).json().total).toBe(1)
    expect((await req(a, 'GET', `/operations/${row.id}`)).json()).toMatchObject({ status: 'completed', note: 'corrected by owner' })
    await sync.applyRecord(a, 'okx_exchange', 'deposits', { ...raw, amt: '11' }, null)
    expect((await req(a, 'GET', `/operations/${row.id}`)).json()).toMatchObject({ status: 'needs_review', note: 'corrected by owner' })
    expect(await db.capitalExternalRecord.count({ where: { userId: a } })).toBe(1)
    expect(await db.capitalExternalRecord.count({ where: { userId: b } })).toBe(1)
    expect((await req(b, 'GET', '/audit')).json().items).toHaveLength(1)
  })
  it('hides connection and run metadata from other owners and handles stale runs', async () => {
    const id = randomUUID()
    await db.capitalSyncRun.create({ data: { id, userId: a, source: 'okx_exchange', status: 'running', heartbeatAt: new Date(0) } })
    expect((await req(b, 'GET', `/sync/okx/${id}`)).statusCode).toBe(404)
    expect((await req(b, 'GET', '/sync/okx/latest')).json()).toBeNull()
    expect((await req(a, 'GET', `/sync/okx/${id}`)).json().status).toBe('interrupted')
    expect((await req(b, 'GET', '/integrations/okx/status')).json()).toEqual({ configured: false, maskedApiKey: null, lastSuccessAt: null })
    expect((await req(b, 'POST', '/sync/okx')).statusCode).toBe(409)
  })
  it('rehearses a complete migration with rollback, applies it and reconciles repeated runs', async () => {
    await create()
    const now = new Date('2026-09-10T10:00:00Z')
    await db.capitalSyncSource.create({ data: { userId: a, id: 'okx_wallet:0x' + 'a'.repeat(40), displayName: 'OKX Wallet', cursor: '{"1":"1000"}', lastSuccessAt: now, updatedAt: now } })
    await db.capitalExternalRecord.create({ data: { userId: a, source: 'okx_wallet', externalId: 'legacy-transaction', kind: '1', payload: { amount: '0.000000000000000001' }, importedAt: now } })
    const backup = (await req(a, 'GET', '/backup')).json()
    const report = await migrateCapital(db, b, backup)
    expect(report).toMatchObject({ mode: 'dry-run-rolled-back', imported: 1, reconciliation: { operations: 1, legs: 2, portfolio: { investedRub: '8000' } } })
    expect(await db.capitalOperation.count({ where: { userId: b } })).toBe(0)
    expect(await db.capitalAsset.count({ where: { userId: b } })).toBe(0)
    expect(await migrateCapital(db, b, backup, true)).toMatchObject({ imported: 1 })
    expect(await migrateCapital(db, b, backup, true)).toMatchObject({ imported: 0, skipped: 1 })
    expect(await db.capitalExternalRecord.count({ where: { userId: b } })).toBe(1)
    expect((await req(a, 'GET', '/portfolio')).json()).toEqual((await req(b, 'GET', '/portfolio')).json())
    backup.operations[0].note = 'incompatible change'
    await expect(migrateCapital(db, b, backup, true)).rejects.toThrow('Сверка операции')
  })
  it('exports a consistent full filtered selection and rejects a stale client owner', async () => {
    const operations = Array.from({ length: 103 }, (_, i) => ({ ...purchase(`selection ${i}`), id: randomUUID() }))
    expect((await req(a, 'POST', '/backup/restore', { references: defaultReferences, operations })).statusCode).toBe(200)
    expect((await req(a, 'GET', '/export?search=selection&page=2&pageSize=20')).json().items).toHaveLength(103)
    expect((await req(b, 'GET', '/export')).json().items).toHaveLength(0)
    const snapshot = (await req(a, 'GET', '/snapshot?page=2')).json()
    expect(snapshot.page.items).toHaveLength(20)
    expect(snapshot.completed).toHaveLength(103)
    expect(snapshot.portfolio.investedRub).toBe('824000')
    expect((await app.inject({ url: '/capital/snapshot', headers: { authorization: `Bearer ${a}`, 'x-capital-owner': String(b) } })).statusCode).toBe(403)
  })

})
