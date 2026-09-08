import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { BUDGET_MS, LIFE_ENDS_MS } from '../src/task-focus.js'

const databaseUrl = process.env.FOCUS_TEST_DATABASE_URL
const apiUrl = process.env.FOCUS_TEST_API_URL
const signingKey = process.env.FOCUS_TEST_JWT_SECRET
const local = (url: string) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
const enabled = databaseUrl && apiUrl && signingKey && local(databaseUrl) && local(apiUrl) && new URL(databaseUrl).pathname.startsWith('/tommma_focus_test_')

test('API: manual life transitions, title-only split, child timers and retained history', { skip: !enabled }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    const user = await prisma.user.create({ data: { nickname: `api${Date.now()}`, email: `${randomUUID()}@example.invalid`, passwordHash: 'isolated-test-only' } })
    const parent = await prisma.task.create({ data: {
      id: randomUUID(), userId: user.id, title: 'Exhausted parent', columnId: 'todo', dateKey: '2026-09-07', recurrence: 'none',
      createdAtMs: BigInt(Date.now()), focusSpentMs: BUDGET_MS, actualSeconds: 120,
      doneWhen: 'Historical condition', workSummary: 'Historical progress',
    } })
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: String(user.id), exp: Math.floor(Date.now() / 1000) + 600 })}`
    const token = `${unsigned}.${createHmac('sha256', signingKey!).update(unsigned).digest('base64url')}`
    const request = async (path: string, method = 'GET', body?: object, status = 200) => {
      const response = await fetch(`${apiUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      assert.equal(response.status, status, `${method} ${path}`)
      return response.json()
    }
    // Prove the local server points to this disposable database before making API writes.
    const initial = await request('/tasks')
    assert.ok(initial.tasks.some((task: { id: string }) => task.id === parent.id), 'API and test database must match')
    for (const lifeEndMs of LIFE_ENDS_MS) {
      const task = await prisma.task.create({ data: {
        id: randomUUID(), userId: user.id, title: 'Life boundary fixture', columnId: 'todo', dateKey: '2026-09-07',
        recurrence: 'none', createdAtMs: BigInt(Date.now()), focusSpentMs: lifeEndMs - 1000,
      } })
      const focusPath = `/tasks/${task.id}/focus`
      const sessionId = randomUUID()
      await request(`${focusPath}/start`, 'POST', { sessionId })
      await prisma.taskWorkSession.update({ where: { id: sessionId }, data: { checkpointAt: new Date(Date.now() - 5000) } })
      const checkpoint = { sessionId, sequence: 1, elapsedMs: 5000 }
      const stopped = await request(`${focusPath}/checkpoint`, 'POST', checkpoint)
      assert.equal(stopped.running, false, `Must stop at ${lifeEndMs}`)
      const row = stopped.tasks.find((row: { id: string }) => row.id === task.id)
      assert.equal(row.focusSpentMs, lifeEndMs, 'Remaining interval must not spend the next life')
      assert.equal(row.focusHeartbeatAt, null)
      const stored = await prisma.taskWorkSession.findUniqueOrThrow({ where: { id: sessionId } })
      assert.equal(stored.creditedMs, 1000)
      assert.ok(stored.endedAt)
      // Both retries and a late heartbeat are inert after the life has ended.
      for (const sequence of [1, 2]) {
        assert.equal((await request(`${focusPath}/checkpoint`, 'POST', { ...checkpoint, sequence })).running, false)
      }
      assert.equal((await request(`${focusPath}/start`, 'POST', { sessionId })).sessionId, null)
      assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).focusSpentMs, lifeEndMs)
      const nextSessionId = randomUUID()
      if (lifeEndMs === BUDGET_MS) {
        await request(`${focusPath}/start`, 'POST', { sessionId: nextSessionId }, 409)
      } else {
        // Only a fresh explicit start begins the next life, at its full duration.
        await request(`${focusPath}/start`, 'POST', { sessionId: nextSessionId })
        await prisma.taskWorkSession.update({ where: { id: nextSessionId }, data: { checkpointAt: new Date(Date.now() - 1000) } })
        const resumed = await request(`${focusPath}/checkpoint`, 'POST', { sessionId: nextSessionId, sequence: 1, elapsedMs: 1000 })
        assert.equal(resumed.running, true)
        assert.ok(resumed.tasks.find((row: { id: string }) => row.id === task.id).focusSpentMs >= lifeEndMs + 1000)
        await request(`${focusPath}/pause`, 'POST', { sessionId: nextSessionId })
      }
    }
    const path = `/tasks/${parent.id}`
    const children = [1, 2].map(n => ({ id: randomUUID(), title: `Child ${n}` }))
    await request(`${path}/focus/start`, 'POST', { sessionId: randomUUID() }, 409)
    await request(`${path}/focus/split`, 'POST', { children: children.slice(0, 1) }, 422)
    await request(`${path}/focus/split`, 'POST', { children })
    await request(`${path}/focus/split`, 'POST', { children })
    assert.equal(await prisma.task.count({ where: { parentTaskId: parent.id } }), 2)
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })
    assert.equal(stored.focusSpentMs, BUDGET_MS)
    assert.equal(stored.actualSeconds, 120)
    assert.equal(stored.doneWhen, 'Historical condition')
    assert.equal(stored.workSummary, 'Historical progress')
    await request(path, 'PATCH', { completed: true }, 409)
    for (const child of children) {
      const sessionId = randomUUID()
      const started = await request(`/tasks/${child.id}/focus/start`, 'POST', { sessionId })
      const fresh = started.tasks.find((task: { id: string }) => task.id === child.id)
      assert.equal(fresh.doneWhen, '')
      assert.ok(fresh.focusSpentMs >= 0 && fresh.focusSpentMs < 1000)
      await request(`/tasks/${child.id}/focus/pause`, 'POST', { sessionId })
      await request(`/tasks/${child.id}`, 'PATCH', { completed: true })
    }
    // Parent stays open until its ordinary checkbox is clicked; no confirmation field.
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).completed, false)
    const completed = await request(path, 'PATCH', { completed: true })
    assert.equal(completed.task.completed, true)
    await request(`/tasks/${children[0]!.id}`, 'PATCH', { completed: false }, 409)
    await request(path, 'PATCH', { completed: false })
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).focusSpentMs, BUDGET_MS)
    await request(path, 'DELETE', {})
    const trash = await request('/tasks/trash')
    assert.equal(trash.tasks.filter((task: { id: string; parentTaskId: string }) => task.id === parent.id || task.parentTaskId === parent.id).length, 3)
  } finally { await prisma.$disconnect() }
})
