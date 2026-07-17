import assert from 'node:assert/strict'
import test from 'node:test'

import {
  comparePriorityInboxTasks,
  comparePriorityTasks,
  priorityGroupForIndex,
  priorityInboxMoveUpdate,
  priorityRankForInsertion,
  priorityWeight,
} from '../src/priority-ranking.js'

function task(overrides: Partial<Parameters<typeof comparePriorityTasks>[0]> = {}) {
  return {
    id: 'task',
    priorityImportance: 0,
    priorityUrgency: 0,
    priorityRank: 1024,
    createdAtMs: 1,
    ...overrides,
  }
}

test('вес равен сумме важности и срочности', () => {
  assert.equal(priorityWeight(task({ priorityImportance: 4, priorityUrgency: 3 })), 7)
})

test('перенос во Входящие сохраняет важность и срочность', () => {
  assert.deepEqual(
    priorityInboxMoveUpdate(task({ priorityImportance: 4, priorityUrgency: 3 })),
    {
      priorityGroup: null,
      priorityImportance: 4,
      priorityUrgency: 3,
    },
  )
})

test('задачи сортируются по весу, затем срочности, важности и сохранённому порядку', () => {
  const tasks = [
    task({ id: 'lower-weight', priorityImportance: 2, priorityUrgency: 2 }),
    task({ id: 'importance-tie', priorityImportance: 4, priorityUrgency: 2 }),
    task({ id: 'later-rank', priorityImportance: 3, priorityUrgency: 3, priorityRank: 2048 }),
    task({ id: 'earlier-rank', priorityImportance: 3, priorityUrgency: 3, priorityRank: 1024 }),
  ].sort(comparePriorityTasks)

  assert.deepEqual(tasks.map((item) => item.id), [
    'earlier-rank',
    'later-rank',
    'importance-tie',
    'lower-weight',
  ])
})

test('задачи во Входящих сортируются только по сохранённому ручному порядку', () => {
  const tasks = [
    task({ id: 'second', priorityImportance: 9, priorityRank: 2048 }),
    task({ id: 'first', priorityUrgency: 9, priorityRank: 1024 }),
  ].sort(comparePriorityInboxTasks)

  assert.deepEqual(tasks.map((item) => item.id), ['first', 'second'])
})

test('новая позиция использует свободный ранг и не меняет остальные задачи', () => {
  assert.equal(priorityRankForInsertion(undefined, 1024), 0)
  assert.equal(priorityRankForInsertion(1024, 3072), 2048)
  assert.equal(priorityRankForInsertion(3072, undefined), 4096)
  assert.equal(priorityRankForInsertion(1024, 1024), null)
})

test('индексы распределяются по группам с ёмкостью от 1 до 9', () => {
  assert.equal(priorityGroupForIndex(0), 1)
  assert.equal(priorityGroupForIndex(1), 2)
  assert.equal(priorityGroupForIndex(2), 2)
  assert.equal(priorityGroupForIndex(3), 3)
  assert.equal(priorityGroupForIndex(5), 3)
  assert.equal(priorityGroupForIndex(6), 4)
  assert.equal(priorityGroupForIndex(44), 9)
  assert.equal(priorityGroupForIndex(45), null)
})
