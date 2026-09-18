import type { NormalizedOperationInput, Operation, OperationFilters, OperationPage, ReferenceData } from '@capital/contracts'
import type { PortfolioResult } from '@capital/domain'
import { request as tommmaRequest, ApiRequestError } from '@/lib/api'

export interface OkxSyncStatus {
  id: string
  status: string
  imported: number
  error: string | null
  startedAt: string
  finishedAt: string | null
  progress?: {
    phase: 'fetching' | 'importing'
    source?: string
    fetched: number
    processed: number
    total: number
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) { super(message) }
}
export function createCapitalApi(userId: string, signal: AbortSignal, onDenied?: (error: ApiError) => void) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (signal.aborted) throw new ApiError('Сессия раздела закрыта', 401)
    try {
      // Tommma's transport always sets application/json. Fastify rejects an
      // empty JSON body for POST/DELETE, including archive and sync actions.
      const body = init.body ?? (init.method && !['GET','HEAD'].includes(init.method) ? '{}' : undefined)
      const result = await tommmaRequest<T>(path.replace('/api', '/capital'), { ...init, body, signal, headers: { 'X-Capital-Owner': userId } })
      if (signal.aborted) throw new ApiError('Сессия раздела закрыта', 401)
      return result
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        const payload = cause.payload as { code?: string; issues?: unknown } | undefined
        const error = new ApiError(cause.message, cause.status, payload?.code, payload?.issues)
        if ([401,403].includes(cause.status)) onDenied?.(error)
        throw error
      }
      throw cause
    }
  }
  return {
  references: () => request<ReferenceData>('/api/references'),
  operations: (filters: OperationFilters) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value))
    })
    return request<OperationPage>(`/api/operations?${params}`)
  },
  exportOperations: (filters: OperationFilters) => {
    const params = new URLSearchParams()
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)) })
    return request<{ items: Operation[] }>(`/api/export?${params}`)
  },
  createOperation: (input: NormalizedOperationInput, allowDuplicate = false) =>
    request<Operation>(`/api/operations${allowDuplicate ? '?allowDuplicate=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateOperation: (id: string, input: NormalizedOperationInput, allowDuplicate = false, confirmReview = false, baseUpdatedAt?: string) =>
    request<Operation>(`/api/operations/${encodeURIComponent(id)}?${new URLSearchParams({ ...(allowDuplicate ? { allowDuplicate: 'true' } : {}), ...(confirmReview ? { confirmReview: 'true' } : {}) })}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, baseUpdatedAt }),
    }),
  archiveOperation: (id: string) => request<void>(`/api/operations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  portfolio: () => request<PortfolioResult>('/api/portfolio'),
  okxStatus: () => request<{ configured: boolean; maskedApiKey: string | null; lastSuccessAt: string | null }>('/api/integrations/okx/status'),
  okxWalletStatus: () => request<{ configured: boolean; maskedAddress: string | null; lastSuccessAt: string | null }>('/api/integrations/okx-wallet/status'),
  startOkxSync: () => request<{ runId: string; alreadyRunning: boolean }>('/api/sync/okx', { method: 'POST' }),
  okxSyncStatus: (runId: string) => request<OkxSyncStatus>(`/api/sync/okx/${runId}`),
  latestOkxSyncStatus: () => request<OkxSyncStatus | null>('/api/sync/okx/latest'),
  startOkxWalletSync: () => request<{ runId: string; alreadyRunning: boolean }>('/api/sync/okx-wallet', { method: 'POST' }),
  okxWalletSyncStatus: (runId: string) => request<OkxSyncStatus>(`/api/sync/okx-wallet/${runId}`),
  latestOkxWalletSyncStatus: () => request<OkxSyncStatus | null>('/api/sync/okx-wallet/latest'),
  backup: () => request<Record<string, unknown>>('/api/backup'),
  restore: (data: unknown) =>
    request<{ imported: number; skipped: number }>('/api/backup/restore', { method: 'POST', body: JSON.stringify(data) }),
    snapshot: (filters: OperationFilters) => {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([k,v]) => { if (v !== undefined && v !== '') params.set(k, String(v)) })
      return request<{ page: OperationPage; portfolio: PortfolioResult; completed: Operation[]; references: ReferenceData }>(`/api/snapshot?${params}`)
    },
    backupState: () => request<{ lastBackupAt: string | null }>('/api/backup/state'),
    backupCreated: () => request<{ lastBackupAt: string }>('/api/backup/created', { method: 'POST' }),
  }
}
