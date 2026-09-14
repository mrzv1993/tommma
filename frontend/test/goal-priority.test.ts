import assert from 'node:assert/strict'
import test from 'node:test'
import { projectGoals } from '../src/app/goal-priority.ts'
import { buildPriorityHierarchy } from '../src/app/priority-hierarchy.ts'
import type { GoalAction, GoalItem } from '../src/lib/goals.ts'

function goal(id: string, patch: Partial<GoalItem> = {}): GoalItem {
  return { id, title: id, createdAt: 1, priorityGroup: null, priorityRank: 1024,
    priorityImportance: 0, priorityUrgency: 0, priorityOverdue: 0,
    completed: false, completedAt: null, deletedAt: null, updatedAt: '2026-09-14T00:00:00.000Z', ...patch }
}
const score = (id: string, delta: -1 | 1): GoalAction => ({ type: 'score', id, field: 'priority', delta })

test('старые оценки складываются без изменения подтверждённого снимка', () => {
  const original = goal('legacy', { priorityImportance: 3, priorityUrgency: 7, priorityOverdue: 9 })
  const projected = projectGoals([original], [])
  assert.equal(projected[0]!.priorityImportance, 19)
  assert.equal(projected[0]!.priorityUrgency, 0)
  assert.equal(projected[0]!.priorityOverdue, 0)
  assert.equal(original.priorityImportance, 3)
  assert.equal(original.priorityUrgency, 7)
  assert.equal(original.priorityOverdue, 9)
})

test('очередь кликов проходит 9, 27 и 100 без потери баллов; ноль возвращает цель во Входящие', () => {
  const original = goal('new')
  const increments = Array.from({ length: 101 }, () => score(original.id, 1))
  let projected = projectGoals([original], increments)
  assert.equal(projected[0]!.priorityImportance, 101)
  assert.equal(projected[0]!.priorityGroup, 1)
  projected = projectGoals(projected, Array.from({ length: 102 }, () => score(original.id, -1)))
  assert.equal(projected[0]!.priorityImportance, 0)
  assert.equal(projected[0]!.priorityGroup, null)
})

test('большая оценка поднимает цель; равные суммы учитывают порядок, а не старые категории', () => {
  const goals = projectGoals([
    goal('first', { priorityImportance: 9, priorityGroup: 1, priorityRank: 1024 }),
    goal('second', { priorityOverdue: 9, priorityGroup: 2, priorityRank: 2048 }),
    goal('highest', { priorityImportance: 999, priorityGroup: 2, priorityRank: 3072 }),
  ], [])
  const ranked = buildPriorityHierarchy(goals).groups.flatMap(group => group.tasks.map(row => row.id))
  assert.deepEqual(ranked, ['highest', 'first', 'second'])
})

test('отклонённый клик откатывается к снимку; оставшиеся клики применяются к подтверждённой сумме', () => {
  const original = goal('legacy', { priorityImportance: 9, priorityUrgency: 9, priorityOverdue: 9 })
  assert.equal(projectGoals([original], [score(original.id, 1), score(original.id, 1)])[0]!.priorityImportance, 29)
  assert.equal(projectGoals([original], [score(original.id, 1)])[0]!.priorityImportance, 28)
  assert.equal(projectGoals([original], [])[0]!.priorityImportance, 27)
})

test('выполненные и удалённые цели не оцениваются; 46-я цель остаётся во Входящих', () => {
  const inactive = [goal('done', { completed: true }), goal('trash', { deletedAt: '2026-09-14T00:00:00.000Z' })]
  assert.ok(projectGoals(inactive, inactive.map(row => score(row.id, 1))).every(row => row.priorityImportance === 0))
  const active = Array.from({ length: 46 }, (_, index) => goal(String(index), { priorityRank: index * 1024 }))
  const hierarchy = buildPriorityHierarchy(projectGoals(active, active.map(row => score(row.id, 1))))
  assert.deepEqual(hierarchy.groups.map(group => group.tasks.length), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(hierarchy.inboxTasks.length, 1)
})
