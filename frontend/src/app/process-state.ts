import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, ApiRequestError } from '@/lib/api'
import type { ProcessAction, ProcessItem } from '@/lib/process-items'

export function useProcessState() {
  const items = ref<ProcessItem[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  let revision = 0
  let disposed = false
  let retryCreate: { id: string; title: string } | null = null
  const message = (cause: unknown) => cause instanceof ApiRequestError && cause.status === 404 && !loaded.value
    ? 'Раздел «Процесс» пока недоступен. Попробуй открыть его позже.'
    : cause instanceof ApiRequestError && cause.status >= 500
      ? 'Не удалось связаться с сервером. Попробуй ещё раз.'
      : cause instanceof Error ? cause.message : 'Не удалось сохранить запись. Попробуй ещё раз.'

  async function load() {
    if (loading.value || busy.value || disposed) return
    const requestRevision = revision
    loading.value = true
    try {
      const result = await api.getProcessItems()
      if (disposed || requestRevision !== revision) return
      items.value = result.items
      loaded.value = true
      error.value = ''
    } catch (cause) {
      if (!disposed && requestRevision === revision) error.value = message(cause)
    } finally { if (!disposed) loading.value = false }
  }

  async function mutate(action: ProcessAction) {
    if (!loaded.value || busy.value || disposed) throw new Error('Дождись сохранения списка')
    ++revision
    busy.value = true
    try {
      const result = await api.mutateProcessItem(action)
      if (!disposed) { items.value = result.items; error.value = '' }
    } catch (cause) {
      if (!disposed) error.value = message(cause)
      throw cause
    } finally { if (!disposed) busy.value = false }
  }

  async function add(title: string) {
    if (!retryCreate || retryCreate.title !== title) retryCreate = { id: crypto.randomUUID(), title }
    await mutate({ type: 'create', ...retryCreate })
    retryCreate = null
  }

  const refresh = () => { if (!document.hidden && loaded.value && !error.value) void load() }
  let interval: ReturnType<typeof setInterval>
  onMounted(() => { interval = setInterval(refresh, 30_000); window.addEventListener('focus', refresh) })
  onBeforeUnmount(() => { disposed = true; ++revision; clearInterval(interval); window.removeEventListener('focus', refresh) })
  return {
    inbox: computed(() => items.value.filter(item => !item.deletedAt)),
    trash: computed(() => items.value.filter(item => item.deletedAt).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!))),
    loaded, loading, busy, error, load, add, mutate,
  }
}
