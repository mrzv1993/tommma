export const PRIORITY_SCORE_MIN = 0
export const PRIORITY_SCORE_MAX = 9
export const PRIORITY_GROUP_MIN = 1
export const PRIORITY_GROUP_MAX = 9
export const PRIORITY_RANK_STEP = 1024
export const PRIORITY_ACTIVE_LIMIT = 45

export type PriorityComparable = {
  priorityImportance: number
  priorityUrgency: number
  priorityRank: number
  createdAtMs: bigint | number
  id: string
}

export function priorityWeight(task: Pick<PriorityComparable, 'priorityImportance' | 'priorityUrgency'>) {
  return task.priorityImportance + task.priorityUrgency
}

export function comparePriorityTasks(left: PriorityComparable, right: PriorityComparable) {
  const weightDifference = priorityWeight(right) - priorityWeight(left)
  if (weightDifference !== 0) return weightDifference

  const urgencyDifference = right.priorityUrgency - left.priorityUrgency
  if (urgencyDifference !== 0) return urgencyDifference

  const importanceDifference = right.priorityImportance - left.priorityImportance
  if (importanceDifference !== 0) return importanceDifference

  if (left.priorityRank !== right.priorityRank) return left.priorityRank - right.priorityRank

  const leftCreatedAt = BigInt(left.createdAtMs)
  const rightCreatedAt = BigInt(right.createdAtMs)
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt < rightCreatedAt ? -1 : 1
  return left.id.localeCompare(right.id)
}

export function priorityGroupStartIndex(group: number) {
  return ((group - 1) * group) / 2
}

export function priorityGroupForIndex(index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= PRIORITY_ACTIVE_LIMIT) return null

  for (let group = PRIORITY_GROUP_MIN; group <= PRIORITY_GROUP_MAX; group += 1) {
    if (index < priorityGroupStartIndex(group) + group) return group
  }
  return null
}
