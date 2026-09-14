import type { PriorityHierarchyTask } from '@/app/priority-hierarchy'
import type { TaskItem } from '@/lib/app-state'

export type GoalItem = PriorityHierarchyTask & {
  title: string
  completed: boolean
  completedAt: string | null
  deletedAt: string | null
  updatedAt: string
}

export type PriorityListItem = TaskItem | GoalItem
export type GoalSnapshot = { ok: true; goals: GoalItem[] }
export type GoalAction =
  | { type: 'create'; id: string; title: string }
  | { type: 'edit'; id: string; title?: string; completed?: boolean; baseUpdatedAt: string; baseTitle?: string }
  | { type: 'score'; id: string; field: 'priority'; delta: -1 | 1 }
  | { type: 'move'; id: string; targetIndex: number }
  | { type: 'delete' | 'restore'; id: string }
