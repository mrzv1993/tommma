import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHmac } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { activityRange, dailyActivity, getTaskActivity } from '../src/task-activity.js'

test('активность: 12 календарных месяцев, локальная дата и високосный февраль', () => {
  const range = activityRange(new Date('2024-02-29T20:00:00Z'), 'Asia/Bangkok')
  assert.equal(range.startDate, '2023-04-01')
  assert.equal(range.endDate, '2024-03-01')
  assert.ok(range.dates.includes('2024-02-29'))
})

test('время суммируется по местным суткам, включая сессию из предыдущего дня', () => {
  const result = dailyActivity(['2026-09-14', '2026-09-15'], [
    { startedAt: new Date('2026-09-13T16:50:00Z'), creditedMs: 30 * 60_000 },
    { startedAt: new Date('2026-09-14T16:40:00Z'), creditedMs: 60 * 60_000 },
    { startedAt: new Date('2026-09-15T01:00:00Z'), creditedMs: 15 * 60_000 },
    { startedAt: new Date('2026-09-15T02:00:00Z'), creditedMs: 0 },
  ], 'Asia/Bangkok')
  assert.deepEqual(result, [{ date: '2026-09-14', focusMs: 40 * 60_000 }, { date: '2026-09-15', focusMs: 55 * 60_000 }])
})

test('переходы DST сохраняют реальную длительность и точную границу суток', () => {
  const spring = dailyActivity(['2026-03-08', '2026-03-09'], [{ startedAt: new Date('2026-03-08T05:00:00Z'), creditedMs: 24 * 3_600_000 }], 'America/New_York')
  assert.deepEqual(spring.map(day => day.focusMs), [23 * 3_600_000, 3_600_000])
  const autumn = dailyActivity(['2026-11-01', '2026-11-02'], [{ startedAt: new Date('2026-11-01T04:00:00Z'), creditedMs: 26 * 3_600_000 }], 'America/New_York')
  assert.deepEqual(autumn.map(day => day.focusMs), [25 * 3_600_000, 3_600_000])
  const exact = dailyActivity(['2026-09-14', '2026-09-15'], [{ startedAt: new Date('2026-09-14T23:00:00Z'), creditedMs: 3_600_000 }], 'UTC')
  assert.deepEqual(exact.map(day => day.focusMs), [3_600_000, 0])
})

const databaseUrl = process.env.FOCUS_TEST_DATABASE_URL
const apiUrl = process.env.FOCUS_TEST_API_URL
const signingKey = process.env.FOCUS_TEST_JWT_SECRET
const local = (url: string) => ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
const enabled = databaseUrl && apiUrl && signingKey && local(databaseUrl) && local(apiUrl) && new URL(databaseUrl).pathname.startsWith('/tommma_focus_test_')

test('API активности: владелец, сумма задач и подзадач, паузы, корзина, текущая жизнь и чтение без записи', { skip: !enabled }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  const users: bigint[] = []
  try {
    const createUser = async () => {
      const user = await prisma.user.create({ data: { nickname: 'activity' + randomUUID().slice(0, 10), email: `${randomUUID()}@example.invalid`, passwordHash: 'isolated-test-only' } })
      users.push(user.id)
      return user
    }
    const user = await createUser(), other = await createUser()
    const makeTask = (userId: bigint, extra = {}) => prisma.task.create({ data: {
      id: randomUUID(), userId, title: 'Activity fixture', columnId: 'todo', dateKey: '2026-09-15', recurrence: 'none', createdAtMs: BigInt(Date.now()), ...extra,
    } })
    const parent = await makeTask(user.id, { isContainer: true, focusSpentMs: 5_400_000 })
    const child = await makeTask(user.id, { parentTaskId: parent.id, completed: true, focusSpentMs: 900_000 })
    const deleted = await makeTask(user.id, { deletedAt: new Date() })
    const hidden = await makeTask(other.id)
    const now = new Date('2026-09-15T12:00:00Z')
    const addSession = (taskId: string, userId: bigint, start: string, minutes: number) => {
      const startedAt = new Date(start), end = new Date(startedAt.getTime() + minutes * 60_000)
      return prisma.taskWorkSession.create({ data: { id: randomUUID(), taskId, userId, startedAt, checkpointAt: end, endedAt: end, creditedMs: minutes * 60_000 } })
    }
    await addSession(parent.id, user.id, '2026-09-14T23:45:00Z', 30)
    await addSession(child.id, user.id, '2026-09-15T02:00:00Z', 15)
    await addSession(child.id, user.id, '2026-09-15T04:00:00Z', 10)
    await addSession(deleted.id, user.id, '2026-09-15T04:00:00Z', 60)
    await addSession(hidden.id, other.id, '2026-09-15T04:00:00Z', 60)
    const running = await makeTask(user.id, { focusSpentMs: 20 * 60_000 })
    await prisma.taskWorkSession.create({ data: {
      id: randomUUID(), taskId: running.id, userId: user.id, startedAt: new Date('2026-09-15T10:55:00Z'), checkpointAt: new Date('2026-09-15T11:00:00Z'), creditedMs: 5 * 60_000,
    } })
    const before = await prisma.taskWorkSession.findMany({ where: { userId: user.id } })
    const result = await getTaskActivity(prisma, user.id, 'UTC', now)
    assert.equal(result.dailyFocus.at(-2)?.focusMs, 15 * 60_000)
    assert.equal(result.dailyFocus.at(-1)?.focusMs, 70 * 60_000) // 15 parent + 25 child + 30 current life.
    assert.deepEqual(await prisma.taskWorkSession.findMany({ where: { userId: user.id } }), before)
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: running.id } })).focusSpentMs, 20 * 60_000)
    assert.ok((await getTaskActivity(prisma, (await createUser()).id, 'UTC', now)).dailyFocus.every(day => day.focusMs === 0))

    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: String(user.id), exp: Math.floor(Date.now() / 1000) + 600 })}`
    const token = `${unsigned}.${createHmac('sha256', signingKey!).update(unsigned).digest('base64url')}`
    const request = (query = '') => fetch(`${apiUrl}/tasks/activity${query}`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal((await fetch(`${apiUrl}/tasks/activity`)).status, 401)
    for (const query of ['?timeZone=Not/AZone', `?userId=${other.id}`, '?days=999']) assert.equal((await request(query)).status, 422)
    const response = await request('?timeZone=Asia%2FBangkok')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.activity.timeZone, 'Asia/Bangkok')
    assert.ok(body.activity.dailyFocus.length >= 335 && body.activity.dailyFocus.length <= 366)
    assert.deepEqual(Object.keys(body.activity.dailyFocus[0]).sort(), ['date', 'focusMs'])
    assert.equal(JSON.stringify(body).includes('Activity fixture'), false)
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    await prisma.$disconnect()
  }
})
