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
      right.priorityImportance + right.priorityUrgency + right.priorityOverdue -
      (left.priorityImportance + left.priorityUrgency + left.priorityOverdue)
    if (weightDifference !== 0) return weightDifference
    if (left.priorityOverdue !== right.priorityOverdue) {
      return right.priorityOverdue - left.priorityOverdue
    }
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
    activeTasks.value
      .filter((task) => task.priorityGroup === null)
      .sort((left, right) => {
        if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank
        if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
        return left.id.localeCompare(right.id)
      }),
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

  const priorityTrashTasks = computed(() =>
    [...options.board.trashedTasks.value].sort((left, right) => {
      const leftDeleted = left.deletedAt ? Date.parse(left.deletedAt) : 0
      const rightDeleted = right.deletedAt ? Date.parse(right.deletedAt) : 0
      return rightDeleted - leftDeleted
    }),
  )

  async function addPriorityTask(title: string) {
    try {
      return await options.board.addPriorityTask(title)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось добавить задачу'))
      throw error
    }
  }

  async function adjustPriorityTaskScore(
    taskId: string,
    field: 'importance' | 'urgency' | 'overdue',
    delta: -1 | 1,
  ) {
    const task = options.board.state.value.tasks.find((item) => item.id === taskId)
    if (!task || task.completed) return
    const current = {
      importance: task.priorityImportance,
      urgency: task.priorityUrgency,
      overdue: task.priorityOverdue,
    }[field]
    const next = Math.min(9, Math.max(0, current + delta))
    if (next === current) return
    try {
      await options.board.updatePriorityTaskScore(taskId, field, next)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось изменить вес задачи'))
      throw error
    }
  }

  async function movePriorityInboxTask(taskId: string, targetIndex: number) {
    const task = options.board.state.value.tasks.find((item) => item.id === taskId)
    if (!task || task.completed || task.priorityGroup !== null) return
    try {
      await options.board.movePriorityTask(taskId, null, targetIndex)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось изменить порядок задач'))
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

  async function restoreDeletedPriorityTask(taskId: string) {
    try {
      await options.board.restoreDeletedTaskFromServer(taskId)
    } catch (error) {
      options.setError(errorMessage(error, 'Не удалось восстановить задачу из Корзины'))
      throw error
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
    movePriorityInboxTask,
    priorityCompletedTasks,
    priorityGroups,
    priorityInboxTasks,
    priorityTrashTasks,
    removePriorityTask,
    restoreDeletedPriorityTask,
    restorePriorityTask,
    updatePriorityTaskTitle,
  }
}
