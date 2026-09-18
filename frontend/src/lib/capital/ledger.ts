import { computed, reactive, ref, watch } from 'vue'
import type { NormalizedOperationInput, Operation, OperationFilters, ReferenceData } from '@capital/contracts'
import type { PortfolioResult } from '@capital/domain'
import { createCapitalApi, ApiError, type OkxSyncStatus } from './api'
import { createCapitalCache } from './cache'
import { calculatePortfolioInWorker, disposePortfolioWorker, warmPortfolioWorker } from './portfolio-worker'

export function createLedgerStore(userId: string) {
  const controller = new AbortController()
  const api = createCapitalApi(userId, controller.signal, cause => denied(cause))
  const scope = `${import.meta.env.VITE_DATA_SOURCE || 'production'}:${import.meta.env.VITE_API_URL || '/api'}:${userId}`
  const cache = createCapitalCache(scope)
  const filterKey = `tommma.capital.filters:${scope}`
  let active = true, sequence = 0
  let pendingSleep: ReturnType<typeof setTimeout> | undefined
  let wakeSleep: (() => void) | undefined
  const operations = ref<Operation[]>([]), references = ref<ReferenceData>({ assets: [], locations: [], networks: [] })
  const portfolio = ref<PortfolioResult>({ positions: [], investedRub: '0', feesRub: '0' })
  const total = ref(0), loading = ref(true), saving = ref(false), syncing = ref(false), recalculating = ref(false), offline = ref(false)
  const syncTarget = ref<'exchange'|'wallet'|null>(null), syncProgress = ref<OkxSyncStatus['progress']>()
  const error = ref<string|null>(null), lastSyncAt = ref<string|null>(null), lastBackupAt = ref<string|null>(null), cacheSavedAt = ref<string|null>(null)
  const okxConnection = ref({ configured: false, maskedApiKey: null as string|null, lastSuccessAt: null as string|null }), okxWalletConnection = ref({ configured: false, maskedAddress: null as string|null, lastSuccessAt: null as string|null })
  const sourceStates = reactive<{ exchange: OkxSyncStatus|null; wallet: OkxSyncStatus|null; exchangeError: string|null; walletError: string|null }>({ exchange: null, wallet: null, exchangeError: null, walletError: null })
  let initial: OperationFilters = { page: 1, pageSize: 20 }
  try { initial = { ...initial, ...JSON.parse(sessionStorage.getItem(filterKey) || '{}') } } catch { /* unavailable cache */ }
  const filters = reactive<OperationFilters>(initial)
  const stopWatch = watch(filters, value => { try { sessionStorage.setItem(filterKey, JSON.stringify(value)) } catch { /* optional cache */ } }, { deep: true })
  const hasFilters = computed(() => Object.entries(filters).some(([key,value]) => !['page','pageSize','sort'].includes(key) && value))
  const backupDue = computed(() => total.value > 0 && (!lastBackupAt.value || Date.now() - Date.parse(lastBackupAt.value) > 7*24*60*60*1000))
  function denied(cause: unknown) {
    if (cause instanceof ApiError && [401,403].includes(cause.status)) {
      operations.value = []; total.value = 0; references.value = { assets: [], locations: [], networks: [] }; portfolio.value = { positions: [], investedRub: '0', feesRub: '0' }
      error.value = cause.message; offline.value = false
      void cache.clear().catch(() => undefined)
      okxConnection.value = { configured: false, maskedApiKey: null, lastSuccessAt: null }
      okxWalletConnection.value = { configured: false, maskedAddress: null, lastSuccessAt: null }
      sourceStates.exchange = null; sourceStates.wallet = null
      lastSyncAt.value = null; lastBackupAt.value = null; cacheSavedAt.value = null
      dispose()
      return true
    }
    return false
  }
  async function loadReferences() {
    try { const value = await api.references(); if (active) references.value = value }
    catch (cause) { if (active && !denied(cause)) error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить справочники' }
  }
  async function load() {
    if (!active || controller.signal.aborted) return
    const requestId = ++sequence
    loading.value = true; error.value = null
    try {
      const snapshot = await api.snapshot({ ...filters })
      if (!active || requestId !== sequence) return
      operations.value = snapshot.page.items; total.value = snapshot.page.total; portfolio.value = snapshot.portfolio; references.value = snapshot.references
      lastSyncAt.value = snapshot.page.lastSyncAt ?? null; offline.value = false
      warmPortfolioWorker()
      await cache.save({ ...snapshot, filters: { ...filters }, savedAt: new Date().toISOString() }).catch(() => undefined)
    } catch (cause) {
      if (!active || requestId !== sequence || denied(cause)) return
      // Invalid requests never fall back to stale data as if the request succeeded.
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) { error.value = cause.message; return }
      const snapshot = await cache.read().catch(() => null)
      if (!active || requestId !== sequence) return
      if (!snapshot) { error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить журнал'; return }
      operations.value = snapshot.page.items; total.value = snapshot.page.total; references.value = snapshot.references
      Object.keys(filters).forEach(k => delete (filters as Record<string,unknown>)[k]); Object.assign(filters, snapshot.filters)
      lastSyncAt.value = snapshot.page.lastSyncAt ?? null; cacheSavedAt.value = snapshot.savedAt; offline.value = true; recalculating.value = true
      try {
        const value = await calculatePortfolioInWorker(snapshot.completed)
        if (active && requestId === sequence) portfolio.value = value
      } catch { if (active && requestId === sequence) error.value = 'Не удалось пересчитать кеш. Повторите загрузку.' }
    } finally { if (active && requestId === sequence) { loading.value = false; recalculating.value = false } }
  }
  async function loadBackupState() {
    try { const value = await api.backupState(); if (active) lastBackupAt.value = value.lastBackupAt }
    catch(cause) { if (active && !denied(cause)) { const value = await cache.backupAt().catch(() => null); if (active) lastBackupAt.value = value } }
  }
  async function recordBackupCreated() {
    const value = await api.backupCreated(); if (!active) return
    lastBackupAt.value = value.lastBackupAt; await cache.markBackup(value.lastBackupAt).catch(() => undefined)
  }
  async function loadOkxStatus() {
    await Promise.allSettled((['exchange','wallet'] as const).map(async target => {
      try {
        const status = target === 'exchange' ? await api.okxStatus() : await api.okxWalletStatus()
        if (!active) return
        if (target === 'exchange') okxConnection.value = status as typeof okxConnection.value
        else okxWalletConnection.value = status as typeof okxWalletConnection.value
        const latest = target === 'exchange' ? await api.latestOkxSyncStatus() : await api.latestOkxWalletSyncStatus()
        if (!active) return
        sourceStates[target] = latest
        sourceStates[`${target}Error`] = sourceStates[target]?.error ?? null
      } catch(cause) { if (active && !denied(cause)) sourceStates[`${target}Error`] = cause instanceof Error ? cause.message : 'Источник недоступен' }
    }))
  }
  async function save(input: NormalizedOperationInput, id?: string, allowDuplicate = false, confirmReview = false, baseUpdatedAt?: string) {
    if (saving.value || offline.value) throw new Error('Дождитесь восстановления связи и завершения сохранения')
    saving.value = true
    try {
      if (id) await api.updateOperation(id, input, allowDuplicate, confirmReview, baseUpdatedAt)
      else await api.createOperation(input, allowDuplicate)
      await load()
    } catch(cause) { denied(cause); throw cause }
    finally { if (active) saving.value = false }
  }
  async function archive(id: string) {
    if (saving.value || offline.value) return
    saving.value = true
    try { await api.archiveOperation(id); await load() } catch(cause) { denied(cause); throw cause } finally { if (active) saving.value = false }
  }
  function resetFilters() { Object.keys(filters).forEach(k => delete (filters as Record<string,unknown>)[k]); Object.assign(filters, { page: 1, pageSize: 20 }) }
  async function runSync(target: 'exchange'|'wallet') {
    if (syncing.value || offline.value) throw new Error('Дождитесь завершения синхронизации')
    syncing.value = true; syncTarget.value = target; sourceStates[`${target}Error`] = null
    try {
      const started = target === 'exchange' ? await api.startOkxSync() : await api.startOkxWalletSync()
      while (active && !controller.signal.aborted) {
        const status = target === 'exchange' ? await api.okxSyncStatus(started.runId) : await api.okxWalletSyncStatus(started.runId)
        if (!active) break
        sourceStates[target] = status; syncProgress.value = status.progress
        if (status.status !== 'running') {
          await load()
          if (status.status !== 'completed') throw new Error(status.error || 'Синхронизация прервана')
          await loadOkxStatus()
          return { imported: status.imported }
        }
        await new Promise<void>(resolve => { wakeSleep = resolve; pendingSleep = setTimeout(resolve, 1000) })
      }
      throw new Error('Сессия раздела закрыта')
    } catch(cause) { if (active && !denied(cause)) sourceStates[`${target}Error`] = cause instanceof Error ? cause.message : 'Ошибка синхронизации'; throw cause }
    finally { if (active) { syncing.value = false; syncTarget.value = null; syncProgress.value = undefined } }
  }
  function dispose() {
    active = false; loading.value = false; syncing.value = false; saving.value = false; sequence++; controller.abort(); stopWatch(); clearTimeout(pendingSleep); wakeSleep?.(); cache.close(); disposePortfolioWorker()
    operations.value = []; references.value = { assets: [], locations: [], networks: [] }; portfolio.value = { positions: [], investedRub: '0', feesRub: '0' }
  }
  return reactive({ api, isActive: () => active && !controller.signal.aborted, operations, references, portfolio, total, loading, saving, syncing, syncTarget, syncProgress, recalculating, offline, error, lastSyncAt, lastBackupAt, cacheSavedAt, okxConnection, okxWalletConnection, filters, hasFilters, backupDue, sourceStates, loadReferences, load, loadBackupState, loadOkxStatus, recordBackupCreated, save, archive, resetFilters, syncOkx: () => runSync('exchange'), syncOkxWallet: () => runSync('wallet'), dispose })
}
