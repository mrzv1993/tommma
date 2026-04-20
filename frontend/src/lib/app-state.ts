import { computed, ref } from 'vue'

import { api } from '@/lib/api'

export type TaskColumn = 'todo' | 'not-do' | 'anti-todo'
export type TaskRecurrence = 'none' | 'daily' | 'weekly'

export type TaskSubtask = {
  id: string
  title: string
  completed: boolean
  createdAt: number
}

export type TaskItem = {
  id: string
  title: string
  column: TaskColumn
  dateKey: string
  recurrenceParentId: string | null
  recurrence: TaskRecurrence
  completed: boolean
  createdAt: number
  subtasks: TaskSubtask[]
  actualSeconds: number
  sessionSeconds: number
  sessionStartedAt: number | null
}

export type DailyProjectEarning = {
  id: string
  projectName: string
  amount: number
}

export type TommmaState = {
  tasks: TaskItem[]
}

type RecentlyDeletedTask = {
  tasksSnapshot: TaskItem[]
  deletedAt: number
  label: string
}

const DEFAULT_STATE: TommmaState = {
  tasks: [],
}

function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateKey(dateKey: string): Date | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function normalizeSubtasks(raw: unknown): TaskSubtask[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Partial<TaskSubtask>
      if (typeof item.id !== 'string' || typeof item.title !== 'string') return null
      return {
        id: item.id,
        title: item.title,
        completed: Boolean(item.completed),
        createdAt: Number(item.createdAt || Date.now()),
      } satisfies TaskSubtask
    })
    .filter((item): item is TaskSubtask => item !== null)
}

function normalizeDbDailyEarningsList(raw: unknown): Array<DailyProjectEarning & { dateKey: string }> {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as {
        id?: unknown
        dateKey?: unknown
        projectName?: unknown
        amount?: unknown
      }
      if (
        typeof item.id !== 'string' ||
        typeof item.dateKey !== 'string' ||
        typeof item.projectName !== 'string' ||
        !parseDateKey(item.dateKey)
      ) {
        return null
      }
      const amount = Number(item.amount ?? 0)
      if (!Number.isFinite(amount)) return null
      return {
        id: item.id,
        dateKey: item.dateKey,
        projectName: item.projectName,
        amount: Math.max(0, amount),
      } satisfies DailyProjectEarning & { dateKey: string }
    })
    .filter((item): item is DailyProjectEarning & { dateKey: string } => item !== null)
}

function normalizeState(raw: unknown): TommmaState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE }

  const source = raw as { tasks?: unknown }

  const tasks = Array.isArray(source.tasks)
    ? source.tasks
        .map((task) => {
          if (!task || typeof task !== 'object') return null
          const item = task as Partial<TaskItem>
          if (
            typeof item.id !== 'string' ||
            typeof item.title !== 'string' ||
            (item.column !== 'todo' && item.column !== 'not-do' && item.column !== 'anti-todo')
          ) {
            return null
          }

          const recurrence: TaskRecurrence =
            item.recurrence === 'daily' || item.recurrence === 'weekly' ? item.recurrence : 'none'

          return {
            id: item.id,
            title: item.title,
            column: item.column,
            dateKey:
              typeof item.dateKey === 'string' && parseDateKey(item.dateKey)
                ? item.dateKey
                : toDateKey(new Date()),
            recurrenceParentId:
              typeof (item as { recurrenceParentId?: unknown }).recurrenceParentId === 'string'
                ? ((item as { recurrenceParentId?: string }).recurrenceParentId ?? null)
                : null,
            recurrence,
            completed: Boolean(item.completed),
            createdAt: Number(item.createdAt || Date.now()),
            subtasks: normalizeSubtasks(item.subtasks),
            actualSeconds: Number(item.actualSeconds || 0),
            sessionSeconds: Number(item.sessionSeconds || 0),
            sessionStartedAt:
              typeof item.sessionStartedAt === 'number' && Number.isFinite(item.sessionStartedAt)
                ? item.sessionStartedAt
                : null,
          } satisfies TaskItem
        })
        .filter((item): item is TaskItem => item !== null)
    : []

  return {
    tasks,
  }
}

function cloneState(state: TommmaState): TommmaState {
  return {
    tasks: [...state.tasks],
  }
}

function cloneTask(task: TaskItem): TaskItem {
  return {
    ...task,
    subtasks: task.subtasks.map((subtask) => ({ ...subtask })),
  }
}

function cloneTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks.map((task) => cloneTask(task))
}

function recurrenceMatchesDate(root: TaskItem, targetDateKey: string): boolean {
  if (root.recurrence === 'none') return false

  const baseDate = parseDateKey(root.dateKey)
  const targetDate = parseDateKey(targetDateKey)
  if (!baseDate || !targetDate) return false
  if (baseDate.getTime() >= targetDate.getTime()) return false

  if (root.recurrence === 'daily') return true
  if (root.recurrence === 'weekly') {
    return baseDate.getDay() === targetDate.getDay()
  }
  return false
}

function cloneSubtasksForRecurrence(subtasks: TaskSubtask[]): TaskSubtask[] {
  return subtasks.map((subtask) => ({
    ...subtask,
    id: crypto.randomUUID(),
    completed: false,
    createdAt: Date.now(),
  }))
}

function commitRunningSession(task: TaskItem, nowMs: number) {
  if (!task.sessionStartedAt) return
  const delta = Math.max(0, Math.floor((nowMs - task.sessionStartedAt) / 1000))
  task.sessionSeconds += delta
  task.sessionStartedAt = null
}

export function useAppState() {
  const state = ref<TommmaState>(cloneState(DEFAULT_STATE))
  const dailyEarningsByDate = ref<Record<string, DailyProjectEarning[]>>({})
  const syncing = ref(false)
  const selectedDateKey = ref(toDateKey(new Date()))
  const recentlyDeleted = ref<RecentlyDeletedTask | null>(null)
  let recentlyDeletedTimeoutId: number | null = null

  const visibleTasks = computed(() =>
    state.value.tasks.filter((task) => task.dateKey === selectedDateKey.value),
  )

  const columns = computed(() => {
    const byColumn = {
      todo: [] as TaskItem[],
      'not-do': [] as TaskItem[],
      'anti-todo': [] as TaskItem[],
    }

    for (const task of visibleTasks.value) {
      byColumn[task.column].push(task)
    }

    return byColumn
  })

  const completion = computed(() => {
    const total = visibleTasks.value.length
    const done = visibleTasks.value.filter((task) => task.completed).length
    return {
      total,
      done,
      percent: total ? Math.round((done / total) * 100) : 0,
    }
  })

  const activeTimerTaskId = computed(() => {
    const running = state.value.tasks.find((task) => task.sessionStartedAt !== null)
    return running ? running.id : null
  })

  const columnCompletion = computed(() => {
    const byColumn = {
      todo: { total: 0, done: 0, percent: 0 },
      'not-do': { total: 0, done: 0, percent: 0 },
      'anti-todo': { total: 0, done: 0, percent: 0 },
    }

    for (const task of visibleTasks.value) {
      byColumn[task.column].total += 1
      if (task.completed) {
        byColumn[task.column].done += 1
      }
    }

    for (const key of Object.keys(byColumn) as TaskColumn[]) {
      const current = byColumn[key]
      current.percent = current.total ? Math.round((current.done / current.total) * 100) : 0
    }

    return byColumn
  })

  const selectedDayEarnings = computed(() => dailyEarningsByDate.value[selectedDateKey.value] ?? [])

  const selectedDayIncomeTotal = computed(() =>
    selectedDayEarnings.value.reduce((sum, item) => sum + item.amount, 0),
  )

  async function load() {
    syncing.value = true
    try {
      const tasksResult = await api.getTasks()
      const nextState = normalizeState({
        tasks: tasksResult.tasks,
      })

      const earningsResult = await api.getEarnings()
      const normalizedEarnings = normalizeDbDailyEarningsList(earningsResult.earnings)
      const earningsByDate = normalizedEarnings.reduce(
        (acc, item) => {
          const dateKey = item.dateKey
          if (!acc[dateKey]) acc[dateKey] = []
          acc[dateKey].push({
            id: item.id,
            projectName: item.projectName,
            amount: item.amount,
          })
          return acc
        },
        {} as Record<string, DailyProjectEarning[]>,
      )
      dailyEarningsByDate.value = earningsByDate

      state.value = nextState
      await ensureRecurringInstancesForDate(selectedDateKey.value)
    } finally {
      syncing.value = false
    }
  }

  async function persistTask(task: TaskItem) {
    await api.patchTask(task.id, {
      title: task.title,
      column: task.column,
      dateKey: task.dateKey,
      recurrenceParentId: task.recurrenceParentId,
      recurrence: task.recurrence,
      completed: task.completed,
      createdAt: task.createdAt,
      actualSeconds: task.actualSeconds,
      sessionSeconds: task.sessionSeconds,
      sessionStartedAt: task.sessionStartedAt,
      subtasks: task.subtasks,
    })
  }

  async function createTask(task: TaskItem) {
    await api.createTask({
      id: task.id,
      title: task.title,
      column: task.column,
      dateKey: task.dateKey,
      recurrenceParentId: task.recurrenceParentId,
      recurrence: task.recurrence,
      completed: task.completed,
      createdAt: task.createdAt,
      actualSeconds: task.actualSeconds,
      sessionSeconds: task.sessionSeconds,
      sessionStartedAt: task.sessionStartedAt,
      subtasks: task.subtasks,
    })
  }

  async function createDailyEarning(dateKey: string, entry: DailyProjectEarning) {
    await api.createEarning({
      id: entry.id,
      dateKey,
      projectName: entry.projectName,
      amount: entry.amount,
    })
  }

  async function persistDailyEarning(entry: DailyProjectEarning) {
    await api.patchEarning(entry.id, {
      projectName: entry.projectName,
      amount: entry.amount,
    })
  }

  function getTaskById(taskId: string) {
    return state.value.tasks.find((item) => item.id === taskId) || null
  }

  function getSeriesRoot(task: TaskItem): TaskItem | null {
    if (task.recurrenceParentId === null) return task
    return state.value.tasks.find((item) => item.id === task.recurrenceParentId) || null
  }

  function getSeriesId(task: TaskItem): string {
    return task.recurrenceParentId ?? task.id
  }

  async function ensureRecurringInstancesForDate(targetDateKey: string) {
    let created = false
    const createdTasks: TaskItem[] = []
    const roots = state.value.tasks.filter(
      (task) => task.recurrence !== 'none' && task.recurrenceParentId === null,
    )

    for (const root of roots) {
      if (!recurrenceMatchesDate(root, targetDateKey)) continue

      const alreadyExists = state.value.tasks.some((item) => {
        const isSameSeries = item.id === root.id || item.recurrenceParentId === root.id
        return isSameSeries && item.dateKey === targetDateKey
      })
      if (alreadyExists) continue

      const instance: TaskItem = {
        id: crypto.randomUUID(),
        title: root.title,
        column: root.column,
        dateKey: targetDateKey,
        recurrenceParentId: root.id,
        recurrence: root.recurrence,
        completed: false,
        createdAt: Date.now(),
        subtasks: cloneSubtasksForRecurrence(root.subtasks),
        actualSeconds: 0,
        sessionSeconds: 0,
        sessionStartedAt: null,
      }
      state.value.tasks.push(instance)
      createdTasks.push(cloneTask(instance))
      created = true
    }

    if (created) {
      await Promise.all(createdTasks.map((task) => createTask(task)))
    }
  }

  async function shiftDate(days: number) {
    const current = parseDateKey(selectedDateKey.value) || new Date()
    const next = new Date(current)
    next.setDate(current.getDate() + days)
    const nextKey = toDateKey(next)
    selectedDateKey.value = nextKey
    await ensureRecurringInstancesForDate(nextKey)
  }

  async function setToday() {
    const today = toDateKey(new Date())
    selectedDateKey.value = today
    await ensureRecurringInstancesForDate(today)
  }

  async function stopAllRunningTimers() {
    let changed = false
    const changedTasks: TaskItem[] = []
    const nowMs = Date.now()
    for (const task of state.value.tasks) {
      if (task.sessionStartedAt) {
        commitRunningSession(task, nowMs)
        task.actualSeconds += task.sessionSeconds
        task.sessionSeconds = 0
        task.sessionStartedAt = null
        changedTasks.push(cloneTask(task))
        changed = true
      }
    }
    if (changed) {
      await Promise.all(changedTasks.map((task) => persistTask(task)))
    }
  }

  async function handleDateBoundary() {
    const today = toDateKey(new Date())
    if (selectedDateKey.value === today) return
    await stopAllRunningTimers()
    selectedDateKey.value = today
    await ensureRecurringInstancesForDate(today)
  }

  function getTaskElapsedSeconds(task: TaskItem, nowMs: number = Date.now()): number {
    let running = 0
    if (task.sessionStartedAt) {
      running = Math.max(0, Math.floor((nowMs - task.sessionStartedAt) / 1000))
    }
    return Math.max(0, task.actualSeconds + task.sessionSeconds + running)
  }

  function ensureDailyEarningsForDate(dateKey: string) {
    if (!dailyEarningsByDate.value[dateKey]) {
      dailyEarningsByDate.value[dateKey] = []
    }
    return dailyEarningsByDate.value[dateKey]
  }

  function getDayEarnings(dateKey: string) {
    return dailyEarningsByDate.value[dateKey] ?? []
  }

  function getDailyEarningsMap() {
    return dailyEarningsByDate.value
  }

  function getDayIncomeTotal(dateKey: string) {
    return getDayEarnings(dateKey).reduce((sum, item) => sum + item.amount, 0)
  }

  async function addDailyEarningForDate(
    dateKey: string,
    projectName: string = 'Новый проект',
    amount: number = 0,
  ) {
    const rows = ensureDailyEarningsForDate(dateKey)
    const nextRow = {
      id: crypto.randomUUID(),
      projectName: projectName.trim() || 'Новый проект',
      amount: Math.max(0, Math.round(amount)),
    }
    rows.push(nextRow)
    await createDailyEarning(dateKey, nextRow)
  }

  async function updateDailyEarningForDate(
    dateKey: string,
    earningId: string,
    patch: Partial<Pick<DailyProjectEarning, 'projectName' | 'amount'>>,
  ) {
    const rows = ensureDailyEarningsForDate(dateKey)
    const target = rows.find((item) => item.id === earningId)
    if (!target) return
    if (typeof patch.projectName === 'string') {
      const nextName = patch.projectName.trim()
      target.projectName = nextName || target.projectName
    }
    if (typeof patch.amount === 'number' && Number.isFinite(patch.amount)) {
      target.amount = Math.max(0, patch.amount)
    }
    await persistDailyEarning(target)
  }

  async function removeDailyEarningForDate(dateKey: string, earningId: string) {
    const rows = ensureDailyEarningsForDate(dateKey)
    dailyEarningsByDate.value[dateKey] = rows.filter((item) => item.id !== earningId)
    await api.deleteEarning(earningId)
  }

  async function addDailyEarning(projectName: string = 'Новый проект') {
    await addDailyEarningForDate(selectedDateKey.value, projectName)
  }

  async function updateDailyEarning(
    earningId: string,
    patch: Partial<Pick<DailyProjectEarning, 'projectName' | 'amount'>>,
  ) {
    await updateDailyEarningForDate(selectedDateKey.value, earningId, patch)
  }

  async function removeDailyEarning(earningId: string) {
    await removeDailyEarningForDate(selectedDateKey.value, earningId)
  }

  async function addTaskForDate(dateKey: string, column: TaskColumn, rawTitle: string) {
    const title = rawTitle.trim()
    if (!title) return

    const nextTask: TaskItem = {
      id: crypto.randomUUID(),
      title,
      column,
      dateKey,
      recurrenceParentId: null,
      recurrence: 'none',
      completed: false,
      createdAt: Date.now(),
      subtasks: [],
      actualSeconds: 0,
      sessionSeconds: 0,
      sessionStartedAt: null,
    }
    state.value.tasks.unshift(nextTask)

    await createTask(nextTask)
  }

  async function addTask(column: TaskColumn, rawTitle: string) {
    await addTaskForDate(selectedDateKey.value, column, rawTitle)
  }

  async function toggleTask(taskId: string) {
    const task = getTaskById(taskId)
    if (!task) return
    task.completed = !task.completed
    await persistTask(task)
  }

  async function updateTaskTitle(taskId: string, rawTitle: string) {
    const task = getTaskById(taskId)
    if (!task) return
    const title = rawTitle.trim()
    if (!title) return
    task.title = title
    await persistTask(task)
  }

  async function moveTask(taskId: string, targetColumn: TaskColumn, targetTaskId: string | null = null) {
    const tasks = state.value.tasks
    const fromIndex = tasks.findIndex((task) => task.id === taskId)
    if (fromIndex === -1) return

    const [movingTask] = tasks.splice(fromIndex, 1)
    movingTask.column = targetColumn

    if (!targetTaskId || targetTaskId === taskId) {
      tasks.push(movingTask)
      await persistTask(movingTask)
      return
    }

    const targetIndex = tasks.findIndex((task) => task.id === targetTaskId)
    if (targetIndex === -1) {
      tasks.push(movingTask)
      await persistTask(movingTask)
      return
    }

    tasks.splice(targetIndex, 0, movingTask)
    await persistTask(movingTask)
  }

  async function updateTaskRecurrence(taskId: string, recurrence: TaskRecurrence) {
    const task = getTaskById(taskId)
    if (!task) return
    if (task.recurrenceParentId) return
    task.recurrence = recurrence
    await persistTask(task)
  }

  async function addSubtask(taskId: string, rawTitle: string) {
    const task = getTaskById(taskId)
    if (!task) return
    const title = rawTitle.trim()
    if (!title) return
    task.subtasks.push({
      id: crypto.randomUUID(),
      title,
      completed: false,
      createdAt: Date.now(),
    })
    await persistTask(task)
  }

  async function toggleSubtask(taskId: string, subtaskId: string) {
    const task = getTaskById(taskId)
    if (!task) return
    const subtask = task.subtasks.find((item) => item.id === subtaskId)
    if (!subtask) return
    subtask.completed = !subtask.completed

    if (task.subtasks.length > 0) {
      const allCompleted = task.subtasks.every((item) => item.completed)
      if (allCompleted) {
        task.completed = true
      }
    }

    await persistTask(task)
  }

  async function removeSubtask(taskId: string, subtaskId: string) {
    const task = getTaskById(taskId)
    if (!task) return
    task.subtasks = task.subtasks.filter((item) => item.id !== subtaskId)
    await persistTask(task)
  }

  async function startTimer(taskId: string) {
    const nowMs = Date.now()
    const changedTaskIds = new Set<string>()

    for (const task of state.value.tasks) {
      if (task.id !== taskId && task.sessionStartedAt) {
        commitRunningSession(task, nowMs)
        changedTaskIds.add(task.id)
      }
    }

    const target = getTaskById(taskId)
    if (!target) return
    if (target.dateKey !== selectedDateKey.value) return
    if (!target.sessionStartedAt) {
      target.sessionStartedAt = nowMs
      changedTaskIds.add(target.id)
    }

    await Promise.all(
      [...changedTaskIds]
        .map((id) => getTaskById(id))
        .filter((task): task is TaskItem => task !== null)
        .map((task) => persistTask(task)),
    )
  }

  async function pauseTimer(taskId: string) {
    const target = getTaskById(taskId)
    if (!target || !target.sessionStartedAt) return
    commitRunningSession(target, Date.now())
    await persistTask(target)
  }

  async function stopTimer(taskId: string) {
    const target = getTaskById(taskId)
    if (!target) return

    if (target.sessionStartedAt) {
      commitRunningSession(target, Date.now())
    }

    target.actualSeconds += target.sessionSeconds
    target.sessionSeconds = 0
    target.sessionStartedAt = null

    await persistTask(target)
  }

  async function removeTask(taskId: string) {
    await removeTaskWithScope(taskId, 'single')
  }

  async function removeTaskWithScope(taskId: string, scope: 'single' | 'following') {
    const existing = getTaskById(taskId)
    if (!existing) return

    const beforeSnapshot = cloneTasks(state.value.tasks)
    const seriesId = getSeriesId(existing)
    const root = getSeriesRoot(existing)
    const cutoffDate = parseDateKey(existing.dateKey)?.getTime() ?? 0
    const idsToDelete = new Set<string>()
    const tasksToPatch: TaskItem[] = []

    if (scope === 'single') {
      state.value.tasks = state.value.tasks.filter((task) => task.id !== taskId)
      idsToDelete.add(taskId)

      if (existing.recurrenceParentId === null && existing.recurrence !== 'none') {
        const futureInstances = state.value.tasks
          .filter(
            (task) =>
              task.recurrenceParentId === existing.id &&
              (parseDateKey(task.dateKey)?.getTime() ?? -1) > cutoffDate,
          )
          .sort((a, b) => {
            const aTs = parseDateKey(a.dateKey)?.getTime() ?? 0
            const bTs = parseDateKey(b.dateKey)?.getTime() ?? 0
            return aTs - bTs
          })

        const promoted = futureInstances[0]
        if (promoted) {
          promoted.recurrenceParentId = null
          promoted.recurrence = existing.recurrence
          tasksToPatch.push(cloneTask(promoted))
        }
      }
    } else {
      const removedTasks = state.value.tasks.filter((task) => {
        const taskSeriesId = getSeriesId(task)
        if (taskSeriesId !== seriesId) return false
        const taskTs = parseDateKey(task.dateKey)?.getTime() ?? 0
        return taskTs >= cutoffDate
      })
      for (const task of removedTasks) {
        idsToDelete.add(task.id)
      }

      state.value.tasks = state.value.tasks.filter((task) => {
        const taskSeriesId = getSeriesId(task)
        if (taskSeriesId !== seriesId) return true
        const taskTs = parseDateKey(task.dateKey)?.getTime() ?? 0
        return taskTs < cutoffDate
      })

      if (root) {
        const rootStillExists = state.value.tasks.some((task) => task.id === root.id)
        if (rootStillExists) {
          const rootTask = state.value.tasks.find((task) => task.id === root.id)
          if (rootTask) {
            rootTask.recurrence = 'none'
            tasksToPatch.push(cloneTask(rootTask))
          }
        }
      }
    }

    recentlyDeleted.value = {
      tasksSnapshot: beforeSnapshot,
      deletedAt: Date.now(),
      label: scope === 'following' ? 'Серия удалена' : 'Задача удалена',
    }

    if (recentlyDeletedTimeoutId) {
      window.clearTimeout(recentlyDeletedTimeoutId)
      recentlyDeletedTimeoutId = null
    }
    recentlyDeletedTimeoutId = window.setTimeout(() => {
      recentlyDeleted.value = null
      recentlyDeletedTimeoutId = null
    }, 5000)

    await Promise.all([...idsToDelete].map((id) => api.deleteTask(id)))
    await Promise.all(tasksToPatch.map((task) => persistTask(task)))
  }

  async function undoRemoveTask() {
    if (!recentlyDeleted.value) return
    const nextTasks = cloneTasks(recentlyDeleted.value.tasksSnapshot)
    const currentById = new Map(state.value.tasks.map((task) => [task.id, task] as const))
    const nextById = new Map(nextTasks.map((task) => [task.id, task] as const))

    const idsToDelete = state.value.tasks
      .filter((task) => !nextById.has(task.id))
      .map((task) => task.id)
    const tasksToCreate = nextTasks.filter((task) => !currentById.has(task.id))
    const tasksToPatch = nextTasks.filter((task) => currentById.has(task.id))

    state.value.tasks = nextTasks
    recentlyDeleted.value = null
    if (recentlyDeletedTimeoutId) {
      window.clearTimeout(recentlyDeletedTimeoutId)
      recentlyDeletedTimeoutId = null
    }
    await Promise.all(idsToDelete.map((id) => api.deleteTask(id)))
    await Promise.all(tasksToCreate.map((task) => createTask(task)))
    await Promise.all(tasksToPatch.map((task) => persistTask(task)))
  }

  return {
    state,
    columns,
    completion,
    columnCompletion,
    selectedDayEarnings,
    selectedDayIncomeTotal,
    getDayEarnings,
    getDailyEarningsMap,
    getDayIncomeTotal,
    activeTimerTaskId,
    syncing,
    recentlyDeleted,
    selectedDateKey,
    load,
    shiftDate,
    setToday,
    stopAllRunningTimers,
    handleDateBoundary,
    getTaskElapsedSeconds,
    addTaskForDate,
    addDailyEarning,
    addDailyEarningForDate,
    updateDailyEarning,
    updateDailyEarningForDate,
    removeDailyEarning,
    removeDailyEarningForDate,
    addTask,
    toggleTask,
    updateTaskTitle,
    moveTask,
    updateTaskRecurrence,
    addSubtask,
    toggleSubtask,
    removeSubtask,
    startTimer,
    pauseTimer,
    stopTimer,
    removeTask,
    removeTaskWithScope,
    undoRemoveTask,
  }
}
