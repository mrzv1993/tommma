import { calculatePortfolio, type PortfolioResult } from '@capital/domain'
import type { Operation } from '@capital/contracts'
import type { PortfolioWorkerRequest, PortfolioWorkerResponse } from '@/workers/capital-portfolio.worker'

let sequence = 0
let worker: Worker | null = null
const pending = new Map<number, { resolve: (result: PortfolioResult) => void; reject: (error: Error) => void; timeout: number }>()

function rejectPending(message: string) {
  for (const request of pending.values()) {
    window.clearTimeout(request.timeout)
    request.reject(new Error(message))
  }
  pending.clear()
  worker?.terminate()
  worker = null
}

function getWorker() {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  worker = new Worker(new URL('../../workers/capital-portfolio.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<PortfolioWorkerResponse>) => {
    const request = pending.get(event.data.requestId)
    if (!request) return
    window.clearTimeout(request.timeout)
    pending.delete(event.data.requestId)
    request.resolve(event.data.result)
  }
  worker.onerror = () => rejectPending('Не удалось выполнить фоновый пересчёт')
  return worker
}

export function calculatePortfolioInWorker(operations: Operation[]): Promise<PortfolioResult> {
  let backgroundWorker: Worker | null
  try { backgroundWorker = getWorker() } catch { return Promise.resolve(calculatePortfolio(operations)) }
  if (!backgroundWorker) return Promise.resolve(calculatePortfolio(operations))

  const requestId = ++sequence
  return new Promise<PortfolioResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('Фоновый пересчёт превысил лимит времени'))
    }, 30_000)
    pending.set(requestId, { resolve, reject, timeout })
    try { backgroundWorker.postMessage({ requestId, operations } satisfies PortfolioWorkerRequest) }
    catch { rejectPending('Фоновый пересчёт недоступен') }
  }).catch(() => calculatePortfolio(operations))
}

// Fetch the worker module while online; an uncached worker cannot boot offline.
export function warmPortfolioWorker() { try { getWorker() } catch { /* same-domain fallback remains available */ } }
export function disposePortfolioWorker() { rejectPending('Сессия раздела закрыта') }
