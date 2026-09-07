import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createFocusTimerController } from '../src/lib/focus-timer-controller.ts'
import { LIFE_ENDS_MS, lifeRemainingMs } from '../src/lib/task-focus.ts'

function fixture(initial = 0) {
  let now = 0
  const totals = new Map([['a', initial], ['b', 0]])
  const calls: { taskId: string; action: string; payload: Record<string, unknown>; accept: (spent: number, running?: boolean) => void; reject: (error: Error) => void }[] = []
  let clock = false
  let errors = 0
  const controller = createFocusTimerController({
    now: () => now, uuid: () => 'session-' + calls.length,
    confirmedMs: id => totals.get(id) ?? 0,
    request: (taskId, action, payload = {}) => new Promise((resolve, reject) => {
      calls.push({ taskId, action, payload, reject, accept: (spent, running = true) => {
        totals.set(taskId, spent)
        resolve({ sessionId: action === 'start' ? String(payload.sessionId) : undefined, running })
      } })
    }),
    changed: () => {}, remember: () => {}, error: () => { errors++ },
    clock: running => { clock = running },
  })
  return { controller, calls, time: (ms: number) => { now = ms }, active: () => controller.activeTaskId(now), spent: (id = 'a') => controller.spentMs(id, now), clock: () => clock, errors: () => errors }
}

test('Play и Pause меняют состояние до ответа сервера, включая паузу во время старта', async () => {
  const f = fixture()
  const start = f.controller.start('a')
  assert.equal(f.active(), 'a')
  await setImmediate()
  f.time(1200)
  assert.equal(f.spent(), 1200)
  const pause = f.controller.pause('a')
  assert.equal(f.active(), null)
  f.time(2000)
  assert.equal(f.spent(), 1200)
  f.calls[0]!.accept(0)
  await start
  await setImmediate()
  assert.equal(f.clock(), false)
  assert.equal(f.calls[1]!.payload.elapsedMs, 1200)
  f.calls[1]!.accept(1200, false)
  await pause
  f.time(9000)
  assert.equal(f.spent(), 1200)
})

test('пауза во время checkpoint фиксирует момент клика и не считает задержку ответа дважды', async () => {
  const f = fixture()
  const start = f.controller.start('a')
  await setImmediate()
  f.calls[0]!.accept(0)
  await start
  f.time(5000)
  const checkpoint = f.controller.checkpoint(5000, false)
  await setImmediate()
  f.time(6200)
  const pause = f.controller.pause('a')
  assert.equal(f.spent(), 6200)
  assert.equal(f.clock(), false)
  f.time(7900)
  f.calls[1]!.accept(5000)
  await checkpoint
  await setImmediate()
  assert.equal(f.active(), null)
  assert.equal(f.spent(), 6200)
  assert.equal(f.calls[2]!.payload.elapsedMs, 1200)
  f.calls[2]!.accept(6200, false)
  await pause
})

test('поздний старт другой задачи не возвращает подсветку и не запускает её worker', async () => {
  const f = fixture()
  const a = f.controller.start('a')
  await setImmediate()
  f.time(400)
  const b = f.controller.start('b')
  assert.equal(f.active(), 'b')
  f.calls[0]!.accept(0)
  await a
  await setImmediate()
  assert.equal(f.clock(), false)
  assert.equal(f.calls[1]!.action, 'checkpoint')
  assert.equal(f.calls[1]!.payload.pause, true)
  f.calls[1]!.accept(400, false)
  await setImmediate()
  f.calls[2]!.accept(0)
  await b
  assert.equal(f.active(), 'b')
  assert.equal(f.clock(), true)
  assert.equal(f.spent(), 400)
})

test('быстрые Play → Pause → Play сохраняют последнее намерение и исключают паузу из времени', async () => {
  const f = fixture()
  const first = f.controller.start('a')
  await setImmediate()
  f.time(1000)
  const pause = f.controller.pause('a')
  f.time(4000)
  const second = f.controller.start('a')
  f.calls[0]!.accept(0)
  await first
  await setImmediate()
  f.calls[1]!.accept(1000, false)
  await pause
  await setImmediate()
  assert.equal(f.active(), 'a')
  f.calls[2]!.accept(1000)
  await second
  f.time(5000)
  assert.equal(f.spent(), 2000)
  assert.equal(f.clock(), true)
})

test('ошибка checkpoint останавливает таймер и возвращает подтверждённое время', async () => {
  const f = fixture(2000)
  const start = f.controller.start('a')
  await setImmediate()
  f.calls[0]!.accept(2000)
  await start
  f.time(5000)
  const checkpoint = f.controller.checkpoint(5000, false)
  const rejected = assert.rejects(checkpoint, /offline/)
  await setImmediate()
  f.calls[1]!.reject(new Error('offline'))
  await rejected
  assert.equal(f.active(), null)
  assert.equal(f.spent(), 2000)
  assert.equal(f.clock(), false)
  assert.equal(f.errors(), 1)
})

test('закрытие страницы во время старта не возобновляет таймер после ответа', async () => {
  const f = fixture()
  const start = f.controller.start('a')
  await setImmediate()
  f.controller.suspend()
  f.calls[0]!.accept(0)
  await setImmediate()
  assert.equal(f.calls[1]!.action, 'pause')
  f.calls[1]!.accept(0, false)
  await start
  assert.equal(f.active(), null)
  assert.equal(f.clock(), false)
})

test('бюджет 90 минут и истёкшая аренда не оставляют активное сердечко', async () => {
  const f = fixture(5399000)
  const start = f.controller.start('a')
  await setImmediate()
  f.calls[0]!.accept(5399000)
  await start
  f.time(1000)
  assert.equal(f.active(), null)
  assert.equal(f.spent(), 5400000)
  f.time(60000)
  const checkpoint = f.controller.checkpoint(60000, true)
  await setImmediate()
  f.calls[1]!.accept(5399000, false)
  await checkpoint
  assert.equal(f.active(), null)
  assert.equal(f.clock(), false)
})

for (const end of LIFE_ENDS_MS) {
  test(`остановка на ${end / 60000} минутах не тратит следующую жизнь до нового Play`, async () => {
    const f = fixture(end - 1000)
    const start = f.controller.start('a')
    await setImmediate()
    f.calls[0]!.accept(end - 1000)
    await start
    f.time(999)
    assert.equal(f.active(), 'a')
    f.time(1000)
    assert.equal(f.active(), null)
    assert.equal(f.spent(), end)
    f.time(5000)
    const checkpoint = f.controller.checkpoint(5000, false)
    await setImmediate()
    f.time(8000) // Slow server response must not animate the next life.
    assert.equal(f.active(), null)
    assert.equal(f.spent(), end)
    f.calls[1]!.accept(end, false)
    await checkpoint
    f.time(60000) // Waiting between lives does not add focus time.
    assert.equal(f.spent(), end)
    assert.equal(f.clock(), false)
    assert.equal(f.calls.length, 2)
    assert.equal(lifeRemainingMs(f.spent()), end === 900000 ? 1800000 : end === 2700000 ? 2700000 : 0)
    if (end < 5400000) {
      const next = f.controller.start('a')
      assert.equal(f.active(), 'a')
      await setImmediate()
      f.calls[2]!.accept(end)
      await next
      f.time(61000)
      assert.equal(f.spent(), end + 1000)
      assert.equal(f.clock(), true)
    }
  })
}

test('Play следующей жизни во время ответа checkpoint сохраняет новое намерение', async () => {
  const f = fixture(899000)
  const start = f.controller.start('a')
  await setImmediate()
  f.calls[0]!.accept(899000)
  await start
  f.time(1000)
  const checkpoint = f.controller.checkpoint(1000, false)
  await setImmediate()
  f.time(1500)
  const next = f.controller.start('a')
  assert.equal(f.active(), 'a')
  f.calls[1]!.accept(900000, false)
  await checkpoint
  await setImmediate()
  assert.equal(f.calls[2]!.action, 'start')
  assert.equal(f.active(), 'a')
  f.calls[2]!.accept(900000)
  await next
  f.time(2500)
  assert.equal(f.active(), 'a')
  assert.equal(f.spent(), 901000)
  assert.equal(f.clock(), true)
})
