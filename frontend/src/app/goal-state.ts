import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { buildPriorityHierarchy } from '@/app/priority-hierarchy'
import { projectGoals } from '@/app/goal-priority'
import { api, ApiRequestError } from '@/lib/api'
import type { GoalAction, GoalItem } from '@/lib/goals'

export function useGoalState() {
  const confirmed = ref<GoalItem[]>([])
  const pending = ref<GoalAction[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  let disposed = false
  let revision = 0
  let tail: Promise<unknown> = Promise.resolve()
  let retryCreate: { title: string; id: string } | null = null
  const goals = computed(() => projectGoals(confirmed.value, pending.value))
  const hierarchy = computed(() => buildPriorityHierarchy(goals.value.filter(goal => !goal.completed && !goal.deletedAt)))
  const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Не удалось сохранить цель. Попробуй ещё раз.'

  async function load() {
    if (loading.value || pending.value.length || disposed) return
    const requestRevision = revision
    loading.value = true
    try {
      const result = await api.getGoals()
      if (disposed || requestRevision !== revision) return
      confirmed.value = result.goals
      loaded.value = true
      error.value = ''
    } catch (cause) {
      if (!disposed && requestRevision === revision) error.value = cause instanceof ApiRequestError && cause.status === 404
        ? 'Цели пока недоступны на сервере. После обновления сервера нажми «Повторить».'
        : message(cause)
    } finally { if (!disposed) loading.value = false }
  }

  function mutate(action: GoalAction): Promise<void> {
    if (!loaded.value || disposed) return Promise.reject(new Error('Сначала загрузи цели'))
    ++revision
    pending.value.push(action)
    // Serial snapshots cannot overwrite later optimistic score clicks or moves.
    const operation = tail.then(async () => {
      if (disposed) return
      try {
        if (action.type === 'edit' && action.title === undefined) {
          const current = confirmed.value.find(goal => goal.id === action.id)
          if (current) action = { ...action, baseUpdatedAt: current.updatedAt }
        }
        const result = await api.mutateGoal(action)
        if (!disposed) { confirmed.value = result.goals; error.value = '' }
      } catch (cause) {
        if (!disposed) error.value = message(cause)
        throw cause
      } finally {
        if (!disposed) pending.value.shift()
      }
    })
    tail = operation.catch(() => {})
    return operation
  }

  async function addTask(title: string) {
    if (!retryCreate || retryCreate.title !== title) retryCreate = { title, id: crypto.randomUUID() }
    await mutate({ type: 'create', ...retryCreate })
    retryCreate = null
  }
  const edit = (id: string, patch: { title?: string; completed?: boolean }) => mutate({ type: 'edit', id, ...patch, baseUpdatedAt: confirmed.value.find(goal => goal.id === id)?.updatedAt ?? '' })
  const bindings = computed(() => ({
    groups: hierarchy.value.groups,
    inboxTasks: hierarchy.value.inboxTasks,
    completedTasks: goals.value.filter(goal => goal.completed && !goal.deletedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    trashedTasks: goals.value.filter(goal => goal.deletedAt).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)),
    addTask,
    adjustScore: (id: string, _field: 'importance' | 'urgency' | 'overdue', delta: -1 | 1) => mutate({ type: 'score', id, field: 'priority', delta }),
    adjustGoalPriority: (id: string, delta: -1 | 1) => mutate({ type: 'score', id, field: 'priority', delta }),
    moveTask: (id: string, targetIndex: number) => mutate({ type: 'move', id, targetIndex }),
    removeTask: (id: string) => mutate({ type: 'delete', id }),
    completeTask: (id: string) => edit(id, { completed: true }).catch(() => {}),
    restoreTask: (id: string) => edit(id, { completed: false }).catch(() => {}),
    restoreDeletedTask: (id: string) => mutate({ type: 'restore', id }),
    updateTaskTitle: (id: string, title: string, baseTitle?: string) => mutate({ type: 'edit', id, title, baseTitle, baseUpdatedAt: confirmed.value.find(goal => goal.id === id)?.updatedAt ?? '' }),
  }))
  const refresh = () => { if (!document.hidden && loaded.value) void load() }
  let interval: ReturnType<typeof setInterval>
  onMounted(() => { interval = setInterval(refresh, 30_000); window.addEventListener('focus', refresh) })
  onBeforeUnmount(() => { disposed = true; ++revision; clearInterval(interval); window.removeEventListener('focus', refresh) })
  return { goals, bindings, load, loading, loaded, error }
}
