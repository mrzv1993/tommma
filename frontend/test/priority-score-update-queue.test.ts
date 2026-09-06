import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PriorityScoreUpdateQueue,
  type PriorityScoreValues,
} from '../src/app/priority-score-update-queue.ts'

const initialValues: PriorityScoreValues = {
  importance: 0,
  urgency: 0,
  overdue: 0,
}

test('быстрые изменения применяются сразу и сохраняются последним выбранным значением', async () => {
  const applied: PriorityScoreValues[] = []
  const persisted: PriorityScoreValues[] = []
  const queue = new PriorityScoreUpdateQueue({
    initialValues,
    batchDelayMs: 0,
    apply: (values) => applied.push({ ...values }),
    persist: async (values) => persisted.push({ ...values }),
  })

  const first = queue.update('importance', 1)
  const second = queue.update('importance', 2)
  const third = queue.update('importance', 3)
  await Promise.all([first, second, third])

  assert.deepEqual(
    applied.slice(0, 3).map((values) => values.importance),
    [1, 2, 3],
  )
  assert.deepEqual(persisted, [{ importance: 3, urgency: 0, overdue: 0 }])
})

test('новое значение не затирается ответом уже выполняющегося запроса', async () => {
  let resolveFirstRequest = () => {}
  const firstRequest = new Promise<void>((resolve) => {
    resolveFirstRequest = resolve
  })
  const applied: PriorityScoreValues[] = []
  const persisted: PriorityScoreValues[] = []
  const queue = new PriorityScoreUpdateQueue({
    initialValues,
    batchDelayMs: 0,
    apply: (values) => applied.push({ ...values }),
    persist: async (values) => {
      persisted.push({ ...values })
      if (persisted.length === 1) await firstRequest
    },
  })

  const saving = queue.update('urgency', 1)
  await Promise.resolve()
  queue.update('urgency', 2)
  resolveFirstRequest()
  await saving

  assert.deepEqual(
    persisted.map((values) => values.urgency),
    [1, 2],
  )
  assert.equal(applied.at(-1)?.urgency, 2)
})

test('ошибка сохранения возвращает последнее подтвержденное значение', async () => {
  const applied: PriorityScoreValues[] = []
  const queue = new PriorityScoreUpdateQueue({
    initialValues: { ...initialValues, overdue: 4 },
    batchDelayMs: 0,
    apply: (values) => applied.push({ ...values }),
    persist: async () => {
      throw new Error('offline')
    },
  })

  await assert.rejects(queue.update('overdue', 5), /offline/)
  assert.equal(applied.at(-1)?.overdue, 4)
})
