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
  const pendingStates: boolean[] = []
  const persisted: PriorityScoreValues[] = []
  const queue = new PriorityScoreUpdateQueue({
    initialValues,
    batchDelayMs: 0,
    apply: (values, pending) => {
      applied.push({ ...values })
      pendingStates.push(pending)
    },
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
  assert.deepEqual(pendingStates.slice(0, 3), [true, true, true])
  assert.equal(pendingStates.at(-1), false)
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

test('возврат к подтвержденному значению сразу снимает оптимистичную проекцию', async () => {
  const pendingStates: boolean[] = []
  const persisted: PriorityScoreValues[] = []
  const queue = new PriorityScoreUpdateQueue({
    initialValues: { ...initialValues, importance: 4 },
    batchDelayMs: 0,
    apply: (_values, pending) => pendingStates.push(pending),
    persist: async (values) => persisted.push({ ...values }),
  })

  const first = queue.update('importance', 5)
  const second = queue.update('importance', 4)
  await Promise.all([first, second])

  assert.deepEqual(pendingStates, [true, false])
  assert.deepEqual(persisted, [])
})

test('промежуточный ответ не снимает проекцию более нового обратного изменения', async () => {
  let resolveFirstRequest = () => {}
  const firstRequest = new Promise<void>((resolve) => {
    resolveFirstRequest = resolve
  })
  const pendingStates: boolean[] = []
  let persistCount = 0
  let queue: PriorityScoreUpdateQueue
  queue = new PriorityScoreUpdateQueue({
    initialValues,
    batchDelayMs: 0,
    apply: (_values, pending) => pendingStates.push(pending),
    persist: async () => {
      persistCount += 1
      if (persistCount === 1) {
        await firstRequest
        queue.reapplyDesiredValues()
      }
    },
  })

  const saving = queue.update('importance', 1)
  await Promise.resolve()
  queue.update('importance', 0)
  resolveFirstRequest()
  await saving

  assert.equal(pendingStates.at(-2), true)
  assert.equal(pendingStates.at(-1), false)
  assert.equal(persistCount, 2)
})

test('ошибка сохранения возвращает последнее подтвержденное значение', async () => {
  const applied: PriorityScoreValues[] = []
  const pendingStates: boolean[] = []
  const queue = new PriorityScoreUpdateQueue({
    initialValues: { ...initialValues, overdue: 4 },
    batchDelayMs: 0,
    apply: (values, pending) => {
      applied.push({ ...values })
      pendingStates.push(pending)
    },
    persist: async () => {
      throw new Error('offline')
    },
  })

  await assert.rejects(queue.update('overdue', 5), /offline/)
  assert.equal(applied.at(-1)?.overdue, 4)
  assert.equal(pendingStates.at(-1), false)
})
