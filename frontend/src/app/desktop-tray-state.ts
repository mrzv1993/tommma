import { computed, nextTick, type Ref } from 'vue'

import type { SessionUser } from '@/lib/api'
import type { TaskItem, useAppState } from '@/lib/app-state'
import {
  createDesktopTrayController,
  type DesktopTrayAction,
  type DesktopTrayController,
} from '@/lib/desktop-tray'
import { daysDiff, toDateKey } from '@/app/date-utils'

type BoardController = ReturnType<typeof useAppState>

type DesktopTrayStateOptions = {
  alignTodayColumnToRight: () => void
  board: BoardController
  clearMessages: () => void
  nowMs: Ref<number>
  selectedDateKey: Ref<string>
  setError: (message: string) => void
  slideDirection: Ref<'left' | 'right'>
  user: Ref<SessionUser | null>
}

export function useDesktopTrayState(options: DesktopTrayStateOptions) {
  let desktopTray: DesktopTrayController | null = null

  const activeTimerTask = computed(() => {
    const activeTaskId = options.board.activeTimerTaskId.value
    if (!activeTaskId) return null
    return options.board.state.value.tasks.find((task) => task.id === activeTaskId) ?? null
  })

  const trayStateKey = computed(() => {
    const activeTask = activeTimerTask.value
    return [
      options.user.value?.id ?? 'guest',
      activeTask?.id ?? 'idle',
      activeTask?.title ?? '',
      activeTask?.actualSeconds ?? 0,
      activeTask?.sessionSeconds ?? 0,
      activeTask?.sessionStartedAt ?? 0,
      options.nowMs.value,
    ].join(':')
  })

  function formatTrayDuration(totalSeconds: number) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds))
    const h = Math.floor(safeSeconds / 3600)
    const m = Math.floor((safeSeconds % 3600) / 60)
    const s = safeSeconds % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function buildTraySnapshot() {
    if (!options.user.value) {
      return {
        title: 'Tommma',
        tooltip: 'Tommma: sign in to start timers',
      }
    }

    const activeTask = activeTimerTask.value
    if (!activeTask) {
      return {
        title: 'Tommma',
        tooltip: 'Tommma: no running timer',
      }
    }

    const elapsed = formatTrayDuration(options.board.getTaskElapsedSeconds(activeTask, options.nowMs.value))
    return {
      title: elapsed,
      tooltip: `${activeTask.title} · ${elapsed}`,
    }
  }

  function syncDesktopTray() {
    if (!desktopTray) return
    void desktopTray.setTimer(buildTraySnapshot()).catch(() => {})
  }

  function getNextTrayTimerTask(): TaskItem | null {
    const today = toDateKey(new Date())
    const todayTodo = options.board.state.value.tasks
      .filter((task) => task.dateKey === today && task.column === 'todo' && !task.completed)
      .sort((a, b) => a.createdAt - b.createdAt)

    if (todayTodo[0]) return todayTodo[0]

    return (
      options.board.state.value.tasks
        .filter((task) => task.dateKey === today && !task.completed)
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
    )
  }

  async function selectTodayForTrayAction() {
    const today = toDateKey(new Date())
    if (options.selectedDateKey.value === today) return

    const diff = daysDiff(options.selectedDateKey.value, today)
    options.slideDirection.value = diff > 0 ? 'left' : 'right'
    await options.board.setToday()
    await nextTick()
    options.alignTodayColumnToRight()
  }

  async function handleTrayStartPause() {
    options.clearMessages()

    if (!options.user.value) {
      options.setError('Войдите в аккаунт, чтобы управлять таймером из status bar')
      return
    }

    const activeTask = activeTimerTask.value
    if (activeTask) {
      await options.board.pauseTimer(activeTask.id)
      return
    }

    const nextTask = getNextTrayTimerTask()
    if (!nextTask) {
      options.setError('На сегодня нет задач для запуска таймера')
      return
    }

    await selectTodayForTrayAction()
    await options.board.startTimer(nextTask.id)
  }

  async function handleTrayStop() {
    options.clearMessages()

    const activeTask = activeTimerTask.value
    if (!activeTask) return
    await options.board.stopTimer(activeTask.id)
  }

  async function handleDesktopTrayAction(action: DesktopTrayAction) {
    try {
      if (action === 'open') {
        if (options.user.value) {
          await selectTodayForTrayAction()
        }
        return
      }

      if (action === 'start-pause') {
        await handleTrayStartPause()
        return
      }

      if (action === 'stop') {
        await handleTrayStop()
        return
      }

      if (action === 'refresh' && options.user.value) {
        await options.board.load()
      }
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось выполнить действие status bar')
    } finally {
      syncDesktopTray()
    }
  }

  function startDesktopTray() {
    void createDesktopTrayController({
      onAction: handleDesktopTrayAction,
    })
      .then((controller) => {
        desktopTray = controller
        syncDesktopTray()
      })
      .catch(() => {})
  }

  function destroyDesktopTray() {
    desktopTray?.destroy()
    desktopTray = null
  }

  return {
    activeTimerTask,
    buildTraySnapshot,
    destroyDesktopTray,
    formatTrayDuration,
    getNextTrayTimerTask,
    handleDesktopTrayAction,
    handleTrayStartPause,
    handleTrayStop,
    selectTodayForTrayAction,
    startDesktopTray,
    syncDesktopTray,
    trayStateKey,
  }
}
