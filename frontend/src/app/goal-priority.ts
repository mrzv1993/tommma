import { buildPriorityHierarchy, priorityTaskWeight } from './priority-hierarchy.ts'
import type { GoalAction, GoalItem } from '../lib/goals'

export function projectGoals(snapshot: GoalItem[], actions: GoalAction[]) {
  // Present legacy scores as one total, without mutating the server snapshot.
  const goals = snapshot.map(goal => ({ ...goal, priorityImportance: priorityTaskWeight(goal), priorityUrgency: 0, priorityOverdue: 0 }))
  for (const action of actions) {
    const goal = goals.find(row => row.id === action.id && !row.completed && !row.deletedAt)
    if (!goal) continue
    if (action.type === 'score') {
      goal.priorityImportance = Math.max(0, goal.priorityImportance + action.delta)
      const ranked = goal.priorityImportance > 0
      if (ranked && goal.priorityGroup === null) goal.priorityRank = Math.max(0, ...goals.filter(row => !row.completed && !row.deletedAt && row.priorityGroup !== null).map(row => row.priorityRank)) + 1024
      goal.priorityGroup = ranked ? goal.priorityGroup ?? 9 : null
      const hierarchy = buildPriorityHierarchy(goals.filter(row => !row.completed && !row.deletedAt))
      for (const group of hierarchy.groups) for (const row of group.tasks) row.priorityGroup = group.id
      for (const row of hierarchy.inboxTasks) row.priorityGroup = null
    } else if (action.type === 'move' && goal.priorityGroup === null) {
      const inbox = buildPriorityHierarchy(goals.filter(row => !row.completed && !row.deletedAt)).inboxTasks.filter(row => row.id !== goal.id)
      inbox.splice(Math.min(action.targetIndex, inbox.length), 0, goal)
      inbox.forEach((row, index) => { row.priorityRank = (index + 1) * 1024 })
    }
  }
  return goals
}
