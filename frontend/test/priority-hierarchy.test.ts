import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPriorityHierarchy,
  type PriorityHierarchyTask,
} from '../src/app/priority-hierarchy.ts'

function task(
  id: string,
  options: Partial<PriorityHierarchyTask> = {},
): PriorityHierarchyTask {
  return {
    id,
    createdAt: 1,
    priorityGroup: null,
    priorityRank: 1024,
    priorityImportance: 0,
    priorityUrgency: 0,
    priorityOverdue: 0,
    ...options,
  }
}

test('подтвержденная сервером принадлежность к группам сохраняется без проекции', () => {
  const ranked = task('ranked', { priorityGroup: 1, priorityImportance: 1 })
  const manuallyMovedToInbox = task('manual-inbox', {
    priorityGroup: null,
    priorityImportance: 9,
    priorityRank: 2048,
  })

  const hierarchy = buildPriorityHierarchy([ranked, manuallyMovedToInbox])

  assert.deepEqual(hierarchy.groups[0]?.tasks.map(({ id }) => id), ['ranked'])
  assert.deepEqual(hierarchy.inboxTasks.map(({ id }) => id), ['manual-inbox'])
})

test('оптимистичное изменение сразу добавляет задачу из Входящих в общий рейтинг', () => {
  const first = task('first', { priorityGroup: 1, priorityImportance: 3, priorityRank: 1024 })
  const optimistic = task('optimistic', {
    priorityGroup: null,
    priorityOverdue: 9,
    priorityRank: 2048,
  })

  const hierarchy = buildPriorityHierarchy([first, optimistic], { optimistic: 'ranked' })

  assert.deepEqual(hierarchy.groups[0]?.tasks.map(({ id }) => id), ['optimistic'])
  assert.deepEqual(hierarchy.groups[1]?.tasks.map(({ id }) => id), ['first'])
  assert.deepEqual(hierarchy.inboxTasks, [])
})

test('нулевой оптимистичный вес сразу возвращает задачу во Входящие', () => {
  const removed = task('removed', { priorityGroup: 1, priorityRank: 1024 })
  const next = task('next', { priorityGroup: 2, priorityImportance: 2, priorityRank: 2048 })

  const hierarchy = buildPriorityHierarchy([removed, next], { removed: 'inbox' })

  assert.deepEqual(hierarchy.groups[0]?.tasks.map(({ id }) => id), ['next'])
  assert.deepEqual(hierarchy.inboxTasks.map(({ id }) => id), ['removed'])
})

test('переполнение после оптимистичного повышения вытесняет слабую задачу во Входящие', () => {
  const ranked = Array.from({ length: 45 }, (_, index) =>
    task(`ranked-п${index}`, {
      priorityGroup: 9,
      priorityImportance: 1,
      priorityRank: (index + 1) * 1024,
      createdAt: index,
    }),
  )
  const promoted = task('promoted', {
    priorityGroup: null,
    priorityImportance: 9,
    priorityRank: 100_000,
  })

  const hierarchy = buildPriorityHierarchy([...ranked, promoted], { promoted: 'ranked' })
  const visibleIds = hierarchy.groups.flatMap((group) => group.tasks.map(({ id }) => id))

  assert.equal(visibleIds.length, 45)
  assert.equal(visibleIds[0], 'promoted')
  assert.deepEqual(hierarchy.inboxTasks.map(({ id }) => id), ['ranked-п44'])
})
