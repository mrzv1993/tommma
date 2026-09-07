import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function worker() {
  let now = 0
  let wall = 100000
  let scheduled: { callback: () => void; delay: number } | undefined
  const messages: { elapsedMs: number; sentAt: number }[] = []
  const self = { onmessage: (_: { data: { type: string; remainingMs: number } }) => {}, postMessage: (message: typeof messages[number]) => messages.push(message) }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/focus-clock.worker.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    self, performance: { now: () => now }, Date: { now: () => wall },
    setTimeout: (callback: () => void, delay: number) => { scheduled = { callback, delay }; return 1 },
    clearTimeout: () => { scheduled = undefined },
  })
  return {
    messages,
    send: (type: string, remainingMs: number) => self.onmessage({ data: { type, remainingMs } }),
    pulse: (extraDelay = 0) => {
      assert.ok(scheduled)
      const next = scheduled
      scheduled = undefined
      now += next.delay + extraDelay
      wall += next.delay + extraDelay
      next.callback()
    },
    scheduled: () => Boolean(scheduled),
  }
}

test('checkpoint у конца сердца отправляется сразу, без ожидания пяти секунд', () => {
  const w = worker()
  w.send('start', 1200)
  w.pulse()
  assert.equal(w.messages.length, 0)
  w.pulse()
  assert.deepEqual(JSON.parse(JSON.stringify(w.messages)), [{ elapsedMs: 1200, sentAt: 101200 }])
  assert.equal(w.scheduled(), false, 'Wait for the server before scheduling another checkpoint')
})

test('обычные checkpoint остаются пятисекундными, stop отменяет следующий', () => {
  const w = worker()
  w.send('start', 30000)
  for (let i = 0; i < 5; i++) w.pulse()
  assert.equal(w.messages[0]!.elapsedMs, 5000)
  w.send('next', 25000)
  assert.equal(w.scheduled(), true)
  w.send('stop', 0)
  assert.equal(w.scheduled(), false)
})

test('пробуждение возле границы сердца передаёт неоднозначный интервал', () => {
  const w = worker()
  w.send('start', 1000)
  w.pulse(60000)
  assert.equal(w.messages[0]!.elapsedMs, 15001)
  assert.equal(w.scheduled(), false)
})
