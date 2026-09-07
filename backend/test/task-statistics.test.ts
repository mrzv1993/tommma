import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHmac } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { completionLife, dateInZone, getTaskStatistics, statisticsDays } from '../src/task-statistics.js'

test('статистика использует календарные дни часового пояса, включая DST и високосный год', () => {
  assert.equal(dateInZone(new Date('2026-09-06T18:00:00Z'), 'Asia/Bangkok'), '2026-09-07')
  assert.equal(dateInZone(new Date('2026-03-08T04:59:00Z'), 'America/New_York'), '2026-03-07')
  assert.deepEqual(statisticsDays('2024-03-01', 3), ['2024-02-28', '2024-02-29', '2024-03-01'])
  assert.equal(statisticsDays('2026-03-10', 7).length, 7)
  assert.deepEqual([0, 899999, 900000, 2699999, 2700000, 5400000].map(completionLife), [1, 1, 2, 2, 3, 3])
})

const databaseUrl = process.env.FOCUS_TEST_DATABASE_URL
const apiUrl = process.env.FOCUS_TEST_API_URL
const signingKey = process.env.FOCUS_TEST_JWT_SECRET
const local = (url: string) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
const enabled = databaseUrl && apiUrl && signingKey && local(databaseUrl) && local(apiUrl) && new URL(databaseUrl).pathname.startsWith('/tommma_focus_test_')

test('API статистики: изоляция, периоды, история завершения, повторное открытие и удалённые сессии', { skip: !enabled }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    const createUser = () => prisma.user.create({ data: { nickname: 'stats' + randomUUID().slice(0, 12), email: `${randomUUID()}@example.invalid`, passwordHash: 'isolated-test-only' } })
    const user = await createUser(), other = await createUser()
    const makeTask = (userId: bigint, extra = {}) => prisma.task.create({ data: {
      id: randomUUID(), userId, title: 'Statistics fixture', columnId: 'todo', dateKey: '2026-09-07', recurrence: 'none', createdAtMs: BigInt(Date.now()), ...extra,
    } })
    const task = await makeTask(user.id, { focusSpentMs: 12 * 60000 })
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: String(user.id), exp: Math.floor(Date.now() / 1000) + 600 })}`
    const token = `${unsigned}.${createHmac('sha256', signingKey!).update(unsigned).digest('base64url')}`
    const request = async (path: string, method = 'GET', body?: object, status = 200) => {
      const response = await fetch(`${apiUrl}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      assert.equal(response.status, status, `${method} ${path}`)
      return response.json()
    }
    assert.ok((await request('/tasks')).tasks.some((row: { id: string }) => row.id === task.id), 'API must use the isolated database')
    assert.equal((await fetch(`${apiUrl}/tasks/statistics`)).status, 401)
    for (const query of ['days=8', 'days=999', 'timeZone=Not/AZone', `userId=${other.id}`]) await request('/tasks/statistics?' + query, 'GET', undefined, 422)
    const path = `/tasks/${task.id}`
    const first = (await request(path, 'PATCH', { completed: true, completedAt: '2000-01-01T00:00:00Z', completionFocusMs: 0 })).task
    assert.equal(first.completionFocusMs, 720000)
    assert.ok(Date.now() - Date.parse(first.completedAt) < 10000)
    const renamed = (await request(path, 'PATCH', { title: 'Renamed after completion' })).task
    assert.equal(renamed.completedAt, first.completedAt)
    assert.equal(renamed.completionFocusMs, 720000)
    await request(path, 'PATCH', { completed: true })
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt?.toISOString(), first.completedAt)
    await makeTask(user.id, { completed: true }) // Legacy date remains unknown.
    await makeTask(user.id, { isContainer: true, completed: true, completedAt: new Date(), completionFocusMs: 5400000 })
    const exhausted = await makeTask(user.id, { focusSpentMs: 5400000 })
    await makeTask(other.id, { focusSpentMs: 5400000, title: 'Other user private task' })
    const deleted = await makeTask(user.id, { deletedAt: new Date() })
    for (const [taskId, owner, offset, credit] of [[task.id, user.id, 0, 720000], [deleted.id, user.id, 0, 300000], [task.id, user.id, 15, 60000]] as const) {
      const at = new Date(Date.now() - offset * 86400000 - 60000)
      await prisma.taskWorkSession.create({ data: { id: randomUUID(), taskId, userId: owner, startedAt: at, checkpointAt: at, endedAt: at, creditedMs: credit } })
    }
    const hidden = await makeTask(other.id, { completed: true, completedAt: new Date(), completionFocusMs: 60000 })
    await prisma.taskWorkSession.create({ data: { id: randomUUID(), taskId: hidden.id, userId: other.id, creditedMs: 999999 } })
    const stats = (await request('/tasks/statistics?days=7&timeZone=Asia%2FBangkok')).statistics
    assert.equal(stats.focusMs, 1020000)
    assert.equal(stats.completedCount, 1)
    assert.equal(stats.classifiedCompletedCount, 1)
    assert.equal(stats.lifeDistribution[0].count, 1)
    assert.equal(stats.undatedCompletedCount, 1)
    assert.deepEqual(stats.exhaustedTasks.map((row: { id: string }) => row.id), [exhausted.id])
    assert.equal(stats.completedTasks[0].id, task.id)
    assert.equal(stats.dailyFocus.reduce((sum: number, row: { focusMs: number }) => sum + row.focusMs, 0), stats.focusMs)
    for (const days of [30, 90]) {
      const expanded = (await request(`/tasks/statistics?days=${days}`)).statistics
      assert.equal(expanded.dailyFocus.length, days)
      assert.equal(expanded.focusMs, 1080000)
    }
    const reopened = (await request(path, 'PATCH', { completed: false })).task
    assert.equal(reopened.completedAt, null)
    assert.equal(reopened.completionFocusMs, null)
    assert.equal((await request('/tasks/statistics')).statistics.completedCount, 0)
    await prisma.task.update({ where: { id: task.id }, data: { focusSpentMs: 38 * 60000 } })
    await request(path, 'PATCH', { completed: true })
    assert.equal((await request('/tasks/statistics')).statistics.lifeDistribution[1].count, 1)
    // A cross-midnight session belongs to its start day in the chosen timezone.
    const isolated = await createUser()
    const dayTask = await makeTask(isolated.id)
    await prisma.taskWorkSession.create({ data: { id: randomUUID(), userId: isolated.id, taskId: dayTask.id, startedAt: new Date('2026-09-06T17:30:00Z'), creditedMs: 3600000 } })
    const tzStats = await getTaskStatistics(prisma, isolated.id, 7, 'Asia/Bangkok', new Date('2026-09-07T02:00:00Z'))
    assert.equal(tzStats.dailyFocus.find(day => day.date === '2026-09-07')?.focusMs, 3600000)
    assert.equal(tzStats.dailyFocus.at(-2)?.focusMs, 0)
  } finally { await prisma.$disconnect() }
})
