import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { createTaskFocus, expireSessions, focusSnapshot, LIFE_ENDS_MS, lockTaskUser } from '../src/task-focus.js'

const url = process.env.FOCUS_TEST_DATABASE_URL
const enabled = url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname) && new URL(url).pathname.startsWith('/tommma_focus_test_')
test('wall clock: offline, reload, boundaries, pause replay and concurrent clients', { skip: !enabled }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const focus = createTaskFocus(prisma)
  const user = await prisma.user.create({ data: { nickname: `continuous${Date.now()}`, email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only' } })
  const task = async (spent = 0) => prisma.task.create({ data: { id: randomUUID(), userId: user.id, title: 'Continuous fixture', columnId: 'todo', dateKey: '2026-09-08', recurrence: 'none', createdAtMs: BigInt(Date.now()), focusSpentMs: spent } })
  const read = () => prisma.$transaction(async tx => { await lockTaskUser(tx, user.id); await expireSessions(tx, user.id); return focusSnapshot(tx, user.id) })
  const shift = async (id: string, ms: number) => {
    const at = new Date(Date.now() - ms)
    await prisma.taskWorkSession.update({ where: { id }, data: { startedAt: at, checkpointAt: at } })
    return at.getTime()
  }
  try {
    const first = await task()
    const id = randomUUID()
    await focus.start(user.id, first.id, id)
    const began = await shift(id, 120000)
    const restored = await read()
    assert.equal(restored?.id, id)
    assert.ok(restored!.spentMs >= 120000 && restored!.spentMs < 121000)
    assert.equal(restored?.lifeEndMs, 900000)
    // A lost response/retry and another reader never count the interval twice.
    await Promise.all([focus.checkpoint(user.id, id, 1, 0, false), focus.checkpoint(user.id, id, 1, 15001, false), read()])
    assert.ok((await read())!.spentMs < 121000)
    // Manual stop was clicked offline at +30s; a later read has already credited +120s.
    await focus.checkpoint(user.id, id, 2, 0, true, began + 30000)
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).focusSpentMs, 30000)
    await focus.pause(user.id, first.id, id, began + 30000)
    assert.equal(await read(), null)
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).focusSpentMs, 30000)
    const next = randomUUID()
    await focus.start(user.id, first.id, next)
    await focus.pause(user.id, first.id, id, began + 10000)
    assert.equal((await read())?.id, next, 'stale pause must not stop a newer run')
    await focus.pause(user.id, first.id, next)
    for (const end of LIFE_ENDS_MS) {
      const row = await task(end - 60000)
      const sid = randomUUID()
      await focus.start(user.id, row.id, sid)
      await shift(sid, 3600000)
      assert.equal(await read(), null, 'returning after sleep ends exactly this life')
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: row.id } })).focusSpentMs, end)
      await focus.checkpoint(user.id, sid, 99, 1, false)
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: row.id } })).focusSpentMs, end)
      assert.equal((await focus.start(user.id, row.id, sid)).sessionId, null)
    }
  } finally { await prisma.$disconnect() }
})
