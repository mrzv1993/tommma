/// <reference lib="webworker" />

import { calculatePortfolio } from '@capital/domain'
import type { Operation } from '@capital/contracts'

export interface PortfolioWorkerRequest {
  requestId: number
  operations: Operation[]
}

export interface PortfolioWorkerResponse {
  requestId: number
  result: ReturnType<typeof calculatePortfolio>
}

self.onmessage = (event: MessageEvent<PortfolioWorkerRequest>) => {
  self.postMessage({
    requestId: event.data.requestId,
    result: calculatePortfolio(event.data.operations),
  } satisfies PortfolioWorkerResponse)
}
