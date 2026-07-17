import { computed } from 'vue'

import type { PriorityGroup, TaskItem, useAppState } from '@/lib/app-state'

type BoardController = ReturnType<typeof useAppState>

type PriorityTaskStateOptions = {
  board: BoardController
  setError: (message: string) => void
}

export type PriorityGroupView = {
  id: PriorityGroup
  limit: number
  tasks: TaskItem[]
}

const PRIORITY_GROUP_IDS: PriorityGroup[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

function sortPriorityTasks(tasks: TaskItem[]) {
  return [...tasks].sort((left, right) => {
    const weightDifference =
      right.priorityImportance + right.priorityUrgency -
      (left.priorityImportance + left.priorityUrgency)
    if (weightDifference !== 0) return weightDifference
    if (left.priorityUrgency !== right.priorityUrgency) {
      return right.priorityUrgency - left.priorityUrgency
    }
    if (left.priorityImportance !== right.priorityImportance) {
      return right.priorityImportance - left.priorityImportance
    }
    if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank
    return left.createdAt - right.createdAt
  })
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function usePriorityTaskState(options: PriorityTaskStateOptions) {
  const activeTasks = computed(() => options.board.state.value.tasks.filter((task) => !task.completed))

  const priorityGroups = computed<PriorityGroupView[]>(() =>
    PRIORITY_GROUP_IDS.map((group) => ({
      id: group,
      limit: group,
      tasks: sortPriorityTasks(activeTasks.value.filter((task) => task.priorityGroup === group)),
    })),
  )

  const priorityInboxTasks = computed(() =>
    sortPriorityTasks(activeTasks.value.filter((task) => task.priorityGroup === null)),
  )

  const priorityCompletedTasks = computed(() =>
    [...options.board.state.value.tasks]
      .filter((task) => task.completed)
      .sort((left, right) => {
        const leftUpdated = left.updatedAt ? Date.parse(left.updatedAt) : left.createdAt
        const rightUpdated = right.updatedAt ? Date.parse(right.updatedAt) : right.createdAt
        return rightUpdated - leftUpdated
      }),
  )

  async function addPriorityTask(title: string, group: PriorityGroup | null) {
    try {
      return await options.board.addPriorityTask(title, group)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось добавить задачу'))
      throw error
    }
  }

  async function movePriorityTask(taskId: string, group: PriorityGroup | null, targetIndex: number) {
    const movingTask = options.board.state.value.tasks.find((task) => task.id === taskId)
    if (!movingTask || movingTask.completed) return
    try {
      await options.board.movePriorityTask(taskId, group, targetIndex)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось переместить задачу'))
    }
  }

  async function adjustPriorityTaskScore(
    taskId: string,
    field: 'importance' | 'urgency',
    delta: -1 | 1,
  ) {
    const task = options.board.state.value.tasks.find((item) => item.id === taskId)
    if (!task || task.completed) return
    const current = field === 'importance' ? task.priorityImportance : task.priorityUrgency
    const next = Math.min(9, Math.max(0, current + delta))
    if (next === current) return
    try {
      await options.board.updatePriorityTaskScore(taskId, field, next)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось изменить вес задачи'))
      throw error
    }
  }

  async function completePriorityTask(taskId: string) {
    try {
      await options.board.completePriorityTask(taskId)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось завершить задачу'))
    }
  }

  async function restorePriorityTask(taskId: string) {
    try {
      await options.board.restorePriorityTask(taskId)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось вернуть задачу во Входящие'))
    }
  }

  async function removePriorityTask(taskId: string) {
    const task = options.board.state.value.tasks.find((item) => item.id === taskId)
    if (!task) return
    try {
      await options.board.removeTask(taskId)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось удалить задачу'))
      throw error
    }
  }

  async function updatePriorityTaskTitle(taskId: string, title: string) {
    const task = options.board.state.value.tasks.find((item) => item.id === taskId)
    if (!task || task.completed) return
    try {
      await options.board.updateTaskTitle(taskId, title)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось изменить название задачи'))
      throw error
    }
  }

  return {
    addPriorityTask,
    adjustPriorityTaskScore,
    completePriorityTask,
    movePriorityTask,
    priorityCompletedTasks,
    priorityGroups,
    priorityInboxTasks,
    removePriorityTask,
    restorePriorityTask,
    updatePriorityTaskTitle,
  }
}
