import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createCapitalCache, type CapitalSnapshot } from './cache'
const snapshot: CapitalSnapshot = { page: { items: [], total: 30, page: 2, pageSize: 20 }, completed: [], references: { assets: [], locations: [], networks: [] }, filters: { page: 2, pageSize: 20 }, savedAt: '2026-09-18T00:00:00Z' }
describe('capital owner cache', () => {
  it('separates both user and environment, keeps pagination and complete portfolio metadata', async () => {
    const tag = crypto.randomUUID()
    const a = createCapitalCache(`local:${tag}:1`), b = createCapitalCache(`local:${tag}:2`), prod = createCapitalCache(`production:${tag}:1`)
    await a.save(snapshot)
    expect(await a.read()).toEqual(snapshot)
    expect(await b.read()).toBeNull(); expect(await prod.read()).toBeNull()
    await a.markBackup('2026-09-18T00:00:00Z')
    expect(await b.backupAt()).toBeNull()
    await Promise.all([a.clear(),b.clear(),prod.clear()])
  })
  it('rejects anonymous owners and stops reads/writes after disposal', async () => {
    expect(() => createCapitalCache('')).toThrow()
    const cache = createCapitalCache(crypto.randomUUID())
    await cache.save(snapshot); cache.close()
    expect(await cache.read()).toBeNull()
    await cache.save({ ...snapshot, savedAt: 'late' })
    await cache.clear()
  })
})
