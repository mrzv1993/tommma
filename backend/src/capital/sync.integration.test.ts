import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { createCapitalSync } from './sync.js'

const provider = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./okx.js', async original => ({ ...await original<typeof import('./okx.js')>(), fetchOkxHistory: provider.fetch, okxConfigured: () => true }))
const url = process.env.CAPITAL_TEST_DATABASE_URL
if (url && (!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Use a local test database')
;(url ? describe : describe.skip)('capital background jobs', { timeout: 30000 }, () => {
  const db = new PrismaClient({ datasources: { db: { url } } })
  const sync = createCapitalSync(db)
  afterEach(() => vi.clearAllMocks())
  afterAll(async () => { await sync.wait(); await db.$disconnect() })
  it('reuses an active run, preserves partial pages without advancing the cursor, and safely retries', async () => {
    const tag = randomUUID()
    const user = await db.user.create({ data: { nickname: tag.slice(0, 20), email: `${tag}@example.test`, passwordHash: 'fixture' } })
    const raw = { depId: 'partial', ccy: 'USDT', amt: '10', chain: 'USDT-TRC20', state: '2', ts: '1700000000000' }
    let resolve!: (value: unknown) => void
    provider.fetch.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const started = await sync.start(user.id, 'okx_exchange')
    expect(await sync.start(user.id, 'okx_exchange')).toEqual({ ...started, alreadyRunning: true })
    resolve({ history: { deposits: [raw] }, cursors: { deposits: 'deposits:partial' }, errors: ['deposits: OKX_HTTP_500'] })
    await sync.wait()
    expect(await sync.status(user.id, 'okx_exchange')).toMatchObject({ status: 'failed', imported: 1 })
    expect((await db.capitalSyncSource.findUniqueOrThrow({ where: { userId_id: { userId: user.id, id: 'okx_exchange' } } })).cursor).toBeNull()
    expect(await db.capitalOperation.count({ where: { userId: user.id, status: 'needs_review' } })).toBe(1)
    provider.fetch.mockResolvedValueOnce({ history: { deposits: [raw] }, cursors: { deposits: 'deposits:partial' }, errors: [] })
    await sync.start(user.id, 'okx_exchange'); await sync.wait()
    expect(await sync.status(user.id, 'okx_exchange')).toMatchObject({ status: 'completed', imported: 0 })
    const source = await db.capitalSyncSource.findUniqueOrThrow({ where: { userId_id: { userId: user.id, id: 'okx_exchange' } } })
    expect(JSON.parse(source.cursor!)).toEqual({ deposits: 'deposits:partial' })
    expect(source.lastSuccessAt).not.toBeNull()
    expect(await db.capitalOperation.count({ where: { userId: user.id } })).toBe(1)
  })
})
