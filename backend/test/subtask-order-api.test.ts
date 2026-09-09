import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac, randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

// Opt in to local integration tests; creates and removes only its own fixtures.
const databaseUrl = process.env.SUBTASK_TEST_DATABASE_URL
const apiUrl = process.env.SUBTASK_TEST_API_URL
const signingKey = process.env.SUBTASK_TEST_JWT_SECRET
const local = (url: string) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
const enabled = databaseUrl && apiUrl && signingKey && local(databaseUrl) && local(apiUrl) && new URL(databaseUrl).pathname.startsWith('/tommma_subtask_test_')

test('API: durable sibling ordering, append, isolation, locked ancestors and running timer', { skip: !enabled }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  const users: bigint[] = []
  try {
    for (let index = 0; index < 2; index++) {
      const user = await prisma.user.create({ data: { nickname: `order${Date.now()}${index}`, email: `${randomUUID()}@example.invalid`, passwordHash: 'local-test-only' } })
      users.push(user.id)
    }
    const userId = users[0]!
    const fixture = (parentTaskId: string | null, extra = {}) => prisma.task.create({ data: {
      id: randomUUID(), userId, title: 'Subtask ordering fixture', columnId: 'todo', dateKey: '2026-09-09', recurrence: 'none',
      createdAtMs: BigInt(Date.now()), parentTaskId, ...extra,
    } })
    const parent = await fixture(null, { isContainer: true, priorityGroup: 1, priorityRank: 1024 })
    const other = await fixture(null, { isContainer: true })
    const foreign = await fixture(null, { userId: users[1] })
    const first = await fixture(parent.id, { createdAtMs: 1n, focusSpentMs: 1234, focusHeartbeatAt: new Date() })
    const second = await fixture(parent.id, { createdAtMs: 2n })
    const third = await fixture(parent.id, { createdAtMs: 3n, isContainer: true })
    const nested = await fixture(third.id)
    const otherChild = await fixture(other.id)
    const session = await prisma.taskWorkSession.create({ data: { id: randomUUID(), userId, taskId: first.id, checkpointAt: new Date() } })
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const tokenFor = (id: bigint) => {
      const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: String(id), exp: Math.floor(Date.now() / 1000) + 600 })}`
      return `${unsigned}.${createHmac('sha256', signingKey!).update(unsigned).digest('base64url')}`
    }
    const request = async (path: string, body?: object, status = 200, token = tokenFor(userId)) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method: body ? 'PATCH' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      assert.equal(response.status, status, path)
      return response.json()
    }
    // Verify the server uses this exact local database before sending any writes.
    assert.ok((await request('/tasks')).tasks.some((task: { id: string }) => task.id === parent.id))
    const initialTask = await prisma.task.findUniqueOrThrow({ where: { id: first.id } })
    const initialSession = await prisma.taskWorkSession.findUniqueOrThrow({ where: { id: session.id } })
    const path = `/tasks/${parent.id}/subtasks/order`
    const move = { childId: third.id, targetId: first.id, position: 'before' }
    await request(path, move, 401, '')
    await request(path, move, 404, tokenFor(users[1]!))
    await request(path, { ...move, position: 'inside' }, 422)
    for (const id of [otherChild.id, foreign.id, nested.id, randomUUID()]) {
      await request(path, { ...move, targetId: id }, 404)
      await request(path, { ...move, childId: id }, 404)
    }
    const result = await request(path, move)
    assert.deepEqual(result.order.map((row: { id: string }) => row.id), [third.id, first.id, second.id])
    assert.ok(result.order.every((row: object) => !('focusSpentMs' in row)), 'Reorder response must not overwrite timer state')
    const ranks = () => prisma.task.findMany({ where: { parentTaskId: parent.id }, orderBy: [{ priorityRank: 'asc' }, { createdAtMs: 'asc' }, { id: 'asc' }] })
    assert.deepEqual((await ranks()).map(row => row.id), [third.id, first.id, second.id])
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).focusSpentMs, initialTask.focusSpentMs)
    assert.deepEqual(await prisma.taskWorkSession.findUniqueOrThrow({ where: { id: session.id } }), initialSession)
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: parent.id } })).priorityRank, 1024)
    const retry = await request(path, move)
    assert.deepEqual(retry.order, result.order, 'Retry is a no-op')
    const added = await fixture(parent.id)
    assert.equal((await ranks()).at(-1)?.id, added.id, 'New rank-0 children append after manual order')
    const downward = await request(path, { childId: third.id, targetId: added.id, position: 'after' })
    assert.deepEqual(downward.order.map((row: { id: string }) => row.id), [first.id, second.id, added.id, third.id])
    // Reads/reloads retain the order, with the same persisted ranks.
    const reload = (await request('/tasks')).tasks.filter((task: { parentTaskId: string }) => task.parentTaskId === parent.id)
    reload.sort((a: { priorityRank: number }, b: { priorityRank: number }) => a.priorityRank - b.priorityRank)
    assert.deepEqual(reload.map((row: { id: string }) => row.id), [first.id, second.id, added.id, third.id])
    await prisma.task.update({ where: { id: parent.id }, data: { completed: true } })
    await request(path, move, 409)
    await request(`/tasks/${third.id}/subtasks/order`, { childId: nested.id, targetId: nested.id, position: 'before' }, 409)
    await prisma.task.update({ where: { id: parent.id }, data: { completed: false } })
    await prisma.task.update({ where: { id: second.id }, data: { deletedAt: new Date() } })
    await request(path, { ...move, targetId: second.id }, 404)
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: nested.id } })).parentTaskId, third.id)
  } finally {
    // Detach only fixtures to satisfy the task tree's Restrict relation.
    await prisma.taskWorkSession.deleteMany({ where: { userId: { in: users } } })
    await prisma.task.updateMany({ where: { userId: { in: users } }, data: { parentTaskId: null } })
    await prisma.task.deleteMany({ where: { userId: { in: users } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  }
})
