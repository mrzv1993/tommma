export type PriorityHierarchyGroupId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type PriorityHierarchyProjectionMode = 'ranked' | 'inbox'

export type PriorityHierarchyTask = {
  id: string
  createdAt: number
  priorityGroup: PriorityHierarchyGroupId | null
  priorityRank: number
  priorityImportance: number
  priorityUrgency: number
  priorityOverdue: number
}

export type PriorityHierarchyGroup<T extends PriorityHierarchyTask> = {
  id: PriorityHierarchyGroupId
  limit: number
  tasks: T[]
}

export type PriorityHierarchy<T extends PriorityHierarchyTask> = {
  groups: PriorityHierarchyGroup<T>[]
  inboxTasks: T[]
}

const PRIORITY_GROUP_IDS: PriorityHierarchyGroupId[] = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export function priorityTaskWeight(task: PriorityHierarchyTask) {
  return task.priorityImportance + task.priorityUrgency + task.priorityOverdue
}

export function comparePriorityHierarchyTasks(
  left: PriorityHierarchyTask,
  right: PriorityHierarchyTask,
) {
  const weightDifference = priorityTaskWeight(right) - priorityTaskWeight(left)
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
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt
  return left.id.localeCompare(right.id)
}

function comparePriorityInboxTasks(left: PriorityHierarchyTask, right: PriorityHierarchyTask) {
  if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank
  if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt
  return left.id.localeCompare(right.id)
}

export function buildPriorityHierarchy<T extends PriorityHierarchyTask>(
  tasks: T[],
  projectionModes: Readonly<Record<string, PriorityHierarchyProjectionMode>> = {},
): PriorityHierarchy<T> {
  const rankedTasks = tasks
    .filter((task) => {
      const projectedMode = projectionModes[task.id]
      if (projectedMode) return projectedMode === 'ranked'
      return task.priorityGroup !== null
    })
    .sort(comparePriorityHierarchyTasks)

  const rankedIds = new Set(rankedTasks.map((task) => task.id))
  let offset = 0
  const groups = PRIORITY_GROUP_IDS.map((id) => {
    const tasksInGroup = rankedTasks.slice(offset, offset + id)
    offset += id
    return { id, limit: id, tasks: tasksInGroup }
  })

  const overflowTasks = rankedTasks.slice(offset)
  const inboxTasks = [
    ...tasks.filter((task) => !rankedIds.has(task.id)),
    ...overflowTasks,
  ].sort(comparePriorityInboxTasks)

  return { groups, inboxTasks }
}
