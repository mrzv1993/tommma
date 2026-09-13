import type { PriorityGroup } from '@/lib/app-state'
import type { PriorityListItem } from '@/lib/goals'

export type PriorityListBindings = {
  groups: { id: PriorityGroup; limit: number; tasks: PriorityListItem[] }[]
  inboxTasks: PriorityListItem[]
  completedTasks: PriorityListItem[]
  trashedTasks: PriorityListItem[]
  addTask: (title: string) => Promise<unknown>
  adjustScore: (
    taskId: string,
    field: 'importance' | 'urgency' | 'overdue',
    delta: -1 | 1,
  ) => Promise<void>
  moveTask: (taskId: string, targetIndex: number) => Promise<void>
  removeTask: (taskId: string) => Promise<void>
  completeTask: (taskId: string) => Promise<void>
  restoreTask: (taskId: string) => Promise<void>
  restoreDeletedTask: (taskId: string) => Promise<void>
  updateTaskTitle: (taskId: string, title: string, baseTitle?: string) => Promise<void>
}
