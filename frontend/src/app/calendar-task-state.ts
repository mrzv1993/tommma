import { computed, nextTick, reactive, ref, type ComputedRef, type Ref } from 'vue'

import type { TaskColumn, TaskItem, useAppState } from '@/lib/app-state'

type BoardController = ReturnType<typeof useAppState>
type WeekDay = { dateKey: string }
type CalendarTaskSection = {
  column: TaskColumn
  title: string
}

export const CALENDAR_TASK_SECTIONS: CalendarTaskSection[] = [
  { column: 'todo', title: 'To Do' },
  { column: 'not-do', title: 'Not To Do' },
  { column: 'anti-todo', title: 'Anti To Do' },
]

type CalendarTaskStateOptions = {
  board: BoardController
  nowMs: Ref<number>
  setError: (message: string) => void
  weekDays: ComputedRef<WeekDay[]>
}

export function useCalendarTaskState(options: CalendarTaskStateOptions) {
  const dailyDrafts = reactive<Record<string, string>>({})
  const addTaskEditing = reactive<Record<string, boolean>>({})
  const editingTaskTitles = reactive<Record<string, string>>({})
  const skipTaskTitleBlurSave = ref<string | null>(null)
  const taskRowClickTimers = new Map<string, number>()

  const taskInputKey = (dateKey: string, column: TaskColumn) => `${dateKey}:${column}`

  const tasksByDay = computed(() => {
    const map = new Map<string, Record<TaskColumn, TaskItem[]>>()
    for (const day of options.weekDays.value) {
      map.set(day.dateKey, {
        todo: [],
        'not-do': [],
        'anti-todo': [],
      })
    }

    for (const task of options.board.state.value.tasks) {
      if (!map.has(task.dateKey)) continue
      map.get(task.dateKey)?.[task.column].push(task)
    }

    for (const byColumn of map.values()) {
      for (const list of Object.values(byColumn)) {
        list.sort((a, b) => a.createdAt - b.createdAt)
      }
    }

    return map
  })

  const progressByDay = computed(() => {
    const map = new Map<string, { total: number; done: number; percent: number }>()
    for (const day of options.weekDays.value) {
      const tasks = Object.values(
        tasksByDay.value.get(day.dateKey) ?? {
          todo: [],
          'not-do': [],
          'anti-todo': [],
        },
      ).flat()
      const total = tasks.length
      const done = tasks.filter((task) => task.completed).length
      map.set(day.dateKey, {
        total,
        done,
        percent: total ? Math.round((done / total) * 100) : 0,
      })
    }
    return map
  })

  async function addTaskForDay(dateKey: string, column: TaskColumn) {
    const key = taskInputKey(dateKey, column)
    const draft = (dailyDrafts[key] || '').trim()
    if (!draft) return
    // Clear draft immediately so saved text never appears in the next input state.
    dailyDrafts[key] = ''
    try {
      await options.board.addTaskForDate(dateKey, column, draft)
      addTaskEditing[key] = true
      await nextTick()
      const input = document.querySelector<HTMLInputElement>(`input[data-add-input="${key}"]`)
      if (input) {
        input.focus()
      }
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось добавить задачу')
    }
  }

  async function startAddTaskEdit(dateKey: string, column: TaskColumn) {
    const key = taskInputKey(dateKey, column)
    addTaskEditing[key] = true
    await nextTick()
    const input = document.querySelector<HTMLInputElement>(`input[data-add-input="${key}"]`)
    input?.focus()
    input?.select()
  }

  function handleAddTaskBlur(dateKey: string, column: TaskColumn) {
    const key = taskInputKey(dateKey, column)
    if ((dailyDrafts[key] || '').trim()) return
    addTaskEditing[key] = false
  }

  function cancelAddTaskEdit(dateKey: string, column: TaskColumn, event: KeyboardEvent) {
    const key = taskInputKey(dateKey, column)
    dailyDrafts[key] = ''
    addTaskEditing[key] = false
    const target = event.target as HTMLInputElement | null
    target?.blur()
  }

  async function toggleTask(taskId: string) {
    try {
      await options.board.toggleTask(taskId)
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось обновить задачу')
    }
  }

  function clearTaskRowClickTimer(taskId: string) {
    const timer = taskRowClickTimers.get(taskId)
    if (!timer) return
    window.clearTimeout(timer)
    taskRowClickTimers.delete(taskId)
  }

  function isTaskTitleEditing(taskId: string) {
    return typeof editingTaskTitles[taskId] === 'string'
  }

  function handleTaskRowClick(taskId: string) {
    if (isTaskTitleEditing(taskId)) return
    clearTaskRowClickTimer(taskId)
    const timer = window.setTimeout(() => {
      taskRowClickTimers.delete(taskId)
      void toggleTask(taskId)
    }, 220)
    taskRowClickTimers.set(taskId, timer)
  }

  function startTaskTitleEdit(task: TaskItem) {
    clearTaskRowClickTimer(task.id)
    editingTaskTitles[task.id] = task.title
    void nextTick(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-task-edit="${task.id}"]`)
      input?.focus()
      input?.select()
    })
  }

  function cancelTaskTitleEdit(taskId: string) {
    delete editingTaskTitles[taskId]
  }

  async function saveTaskTitleEdit(taskId: string) {
    const nextTitle = editingTaskTitles[taskId]
    if (typeof nextTitle !== 'string') return
    delete editingTaskTitles[taskId]
    try {
      await options.board.updateTaskTitle(taskId, nextTitle)
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось обновить задачу')
    }
  }

  async function handleTaskTitleBlur(taskId: string) {
    if (skipTaskTitleBlurSave.value === taskId) {
      skipTaskTitleBlurSave.value = null
      return
    }
    await saveTaskTitleEdit(taskId)
  }

  async function handleTaskTitleEnter(taskId: string, event: KeyboardEvent) {
    skipTaskTitleBlurSave.value = taskId
    await saveTaskTitleEdit(taskId)
    const target = event.target as HTMLInputElement | null
    target?.blur()
  }

  function handleTaskTitleEscape(taskId: string, event: KeyboardEvent) {
    skipTaskTitleBlurSave.value = taskId
    cancelTaskTitleEdit(taskId)
    const target = event.target as HTMLInputElement | null
    target?.blur()
  }

  async function removeTaskById(taskId: string) {
    clearTaskRowClickTimer(taskId)
    cancelTaskTitleEdit(taskId)
    try {
      await options.board.removeTask(taskId)
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось удалить задачу')
    }
  }

  function scoreTarget(task: TaskItem) {
    const lower = task.title.toLowerCase()
    if (lower.includes('заработ')) return 240
    if (lower.includes('молит')) return 20
    if (lower.includes('размин')) return 20
    if (lower.includes('чтени')) return 20
    const match = task.title.match(/\/\s*(\d{1,4})$/)
    if (match) return Number(match[1])
    return null
  }

  function scoreLabel(task: TaskItem) {
    const target = scoreTarget(task)
    if (!target) return null
    const elapsedMinutes = Math.floor(options.board.getTaskElapsedSeconds(task, options.nowMs.value) / 60)
    const fact = elapsedMinutes > 0 ? elapsedMinutes : task.completed ? target : 0
    return `${Math.min(fact, target)} / ${target}`
  }

  function dayPercent(dateKey: string) {
    return progressByDay.value.get(dateKey)?.percent ?? 0
  }

  function cleanupTaskRowClickTimers() {
    for (const timer of taskRowClickTimers.values()) {
      window.clearTimeout(timer)
    }
    taskRowClickTimers.clear()
  }

  return {
    addTaskEditing,
    addTaskForDay,
    cancelAddTaskEdit,
    cancelTaskTitleEdit,
    calendarTaskSections: CALENDAR_TASK_SECTIONS,
    cleanupTaskRowClickTimers,
    clearTaskRowClickTimer,
    dailyDrafts,
    dayPercent,
    editingTaskTitles,
    handleAddTaskBlur,
    handleTaskRowClick,
    handleTaskTitleBlur,
    handleTaskTitleEnter,
    handleTaskTitleEscape,
    isTaskTitleEditing,
    progressByDay,
    removeTaskById,
    saveTaskTitleEdit,
    scoreLabel,
    scoreTarget,
    skipTaskTitleBlurSave,
    startAddTaskEdit,
    startTaskTitleEdit,
    taskInputKey,
    tasksByDay,
    toggleTask,
  }
}
