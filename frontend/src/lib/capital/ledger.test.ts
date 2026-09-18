import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createLedgerStore } from './ledger'
import { ApiError } from './api'

const mock = vi.hoisted(() => ({ api: { snapshot: vi.fn(), createOperation: vi.fn() }, cache: { save: vi.fn(), read: vi.fn(), clear: vi.fn().mockResolvedValue(undefined), close: vi.fn() }, worker: vi.fn() }))
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), createCapitalApi: () => mock.api }))
vi.mock('./cache', () => ({ createCapitalCache: () => mock.cache }))
vi.mock('./portfolio-worker', () => ({ calculatePortfolioInWorker: mock.worker, disposePortfolioWorker: vi.fn(), warmPortfolioWorker: vi.fn() }))
const portfolio = { positions: [], investedRub: '8000', feesRub: '0' }
const snapshot = { page: { items: [{ id: 'own-operation' }], total: 1, page: 1, pageSize: 20 }, completed: [{ id: 'entire-portfolio' }], references: { assets: [], locations: [], networks: [] }, portfolio, filters: { page: 1, pageSize: 20 }, savedAt: '2026-09-18T12:00:00Z' }
const stores: ReturnType<typeof createLedgerStore>[] = []
function store() { const scope = effectScope(); const value = scope.run(() => createLedgerStore('1'))!; stores.push(value); return value }
afterEach(() => { stores.forEach(s => s.dispose()); stores.length = 0; vi.clearAllMocks(); sessionStorage.clear() })

describe('capital session lifecycle and offline recovery', () => {
  it('reads an owner snapshot offline, calculates the full portfolio and prevents writes until recovered', async () => {
    mock.api.snapshot.mockRejectedValueOnce(new TypeError('Network unavailable')).mockResolvedValueOnce(snapshot)
    mock.cache.read.mockResolvedValue(snapshot); mock.worker.mockResolvedValue(portfolio); mock.cache.save.mockResolvedValue(undefined)
    const ledger = store()
    await ledger.load()
    expect(ledger.offline).toBe(true)
    expect(ledger.cacheSavedAt).toBe(snapshot.savedAt)
    expect(mock.worker).toHaveBeenCalledWith(snapshot.completed)
    await expect(ledger.save({} as never)).rejects.toThrow()
    expect(mock.api.createOperation).not.toHaveBeenCalled()
    await ledger.load()
    expect(ledger.offline).toBe(false)
    expect(ledger.portfolio.investedRub).toBe('8000')
  })
  it.each([401,403])('never exposes cached financial data after HTTP %s', async status => {
    mock.api.snapshot.mockRejectedValue(new ApiError('Session invalid', status))
    const ledger = store(); await ledger.load()
    expect(mock.cache.read).not.toHaveBeenCalled()
    expect(mock.cache.clear).toHaveBeenCalled()
    expect(ledger.operations).toEqual([])
    expect(ledger.isActive()).toBe(false)
  })
  it('ignores a late response after logout or account switch', async () => {
    let resolve!: (value: unknown) => void
    mock.api.snapshot.mockReturnValue(new Promise(r => { resolve = r }))
    const ledger = store(); const pending = ledger.load(); ledger.dispose(); resolve(snapshot); await pending
    expect(ledger.operations).toEqual([])
    expect(mock.cache.save).not.toHaveBeenCalled()
  })
  it('shows an invalid-request error without using stale cache', async () => {
    mock.api.snapshot.mockRejectedValue(new ApiError('Invalid filter', 422))
    const ledger = store(); await ledger.load()
    expect(ledger.error).toBe('Invalid filter')
    expect(mock.cache.read).not.toHaveBeenCalled()
  })
})
