import { afterEach, expect, it, vi } from 'vitest'
import { calculatePortfolioInWorker, disposePortfolioWorker } from './portfolio-worker'
import { calculatePortfolio } from '@capital/domain'
import type { Operation } from '@capital/contracts'

const operations: Operation[] = [{ id: 'one', type: 'purchase', status: 'completed', source: 'manual', timezone: 'UTC', occurredAt: '2026-09-01T10:00:00Z', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', locationToId: 'okx', legs: [{ id: 'out', direction: 'out', assetId: 'rub', amount: '8000.01', position: 0 }, { id: 'in', direction: 'in', assetId: 'usdt', amount: '100.000001', locationId: 'okx', position: 1 }] }]
afterEach(() => { disposePortfolioWorker(); vi.unstubAllGlobals() })
it('calculates an exact offline snapshot if the worker module fails to load', async () => {
  vi.stubGlobal('Worker', class {
    onerror?: () => void
    terminate() {}
    postMessage() { queueMicrotask(() => this.onerror?.()) }
  })
  expect(await calculatePortfolioInWorker(operations)).toEqual(calculatePortfolio(operations))
})
it('falls back when the browser does not allow worker construction', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Unavailable offline') } })
  expect(await calculatePortfolioInWorker(operations)).toEqual(calculatePortfolio(operations))
})
