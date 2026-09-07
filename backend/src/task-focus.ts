import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient, Task } from '@prisma/client'

export const BUDGET_MS = 90 * 60_000
export const LEASE_MS = 15_000
export const LIFE_ENDS_MS = [15 * 60_000, 45 * 60_000, BUDGET_MS]
export const livesLeft = (ms: number) => LIFE_ENDS_MS.filter(end => ms < end).length
export class FocusError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function lockTaskUser(tx: Prisma.TransactionClient, userId: bigint) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${userId})::text AS locked`
}
export async function endSessions(tx: Prisma.TransactionClient, userId: bigint, taskIds?: string[]) {
  const where = { userId, endedAt: null, ...(taskIds ? { taskId: { in: taskIds } } : {}) }
  const sessions = await tx.taskWorkSession.findMany({ where })
  await tx.taskWorkSession.updateMany({ where, data: { endedAt: new Date() } })
  if (sessions.length) await tx.task.updateMany({
    where: { userId, id: { in: sessions.map(s => s.taskId) } }, data: { focusHeartbeatAt: null },
  })
}
export async function expireSessions(tx: Prisma.TransactionClient, userId: bigint) {
  const expired = await tx.taskWorkSession.findMany({
    where: { userId, endedAt: null, checkpointAt: { lt: new Date(Date.now() - LEASE_MS) } },
  })
  if (expired.length) await endSessions(tx, userId, expired.map(s => s.taskId))
}
export async function assertAncestorsOpen(tx: Prisma.TransactionClient, task: Task, allowCompleted = false) {
  let parentId = task.parentTaskId
  while (parentId) {
    const parent = await tx.task.findFirst({ where: { id: parentId, userId: task.userId } })
    if (!parent || parent.deletedAt || (parent.completed && !allowCompleted)) throw new FocusError(409, 'Сначала открой или восстанови родительскую задачу')
    parentId = parent.parentTaskId
  }
}
export function descendantIds(tasks: Task[], id: string): string[] {
  const found = new Set([id])
  const children = new Map<string, string[]>()
  for (const task of tasks) if (task.parentTaskId) {
    children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task.id])
  }
  for (const parent of found) for (const child of children.get(parent) ?? []) found.add(child)
  return [...found]
}
// Server and worker clocks bound each confirmed interval. Missing heartbeats add zero.
export function confirmedInterval(serverMs: number, clientMs: number): number {
  if (serverMs < 0 || clientMs < 0 || serverMs > LEASE_MS || clientMs > LEASE_MS) return 0
  // Sleep or clock discontinuity on platforms whose monotonic clock stops during sleep.
  if (Math.abs(serverMs - clientMs) > 3000) return 0
  return Math.floor(Math.min(serverMs, clientMs))
}
export function createTaskFocus(prisma: PrismaClient) {
  const transact = <T>(userId: bigint, fn: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
    await lockTaskUser(tx, userId)
    await expireSessions(tx, userId)
    return fn(tx)
  })
  return {
    async start(userId: bigint, taskId: string, sessionId: string) {
      return transact(userId, async tx => {
        const previous = await tx.taskWorkSession.findUnique({ where: { id: sessionId } })
        if (previous) {
          if (previous.userId !== userId || previous.taskId !== taskId) throw new FocusError(409, 'Сессия недоступна')
          return { sessionId: previous.endedAt ? null : previous.id }
        }
        const task = await tx.task.findFirst({ where: { id: taskId, userId, deletedAt: null } })
        if (!task) throw new FocusError(404, 'Задача не найдена')
        await assertAncestorsOpen(tx, task)
        if (task.completed || task.isContainer) throw new FocusError(409, 'Таймер доступен только у незавершённой исполняемой задачи')
        if (task.focusSpentMs >= BUDGET_MS) throw new FocusError(409, 'Бюджет задачи исчерпан. Разбей оставшуюся работу на подзадачи')
        await endSessions(tx, userId)
        const now = new Date()
        await tx.taskWorkSession.create({ data: { id: sessionId, userId, taskId, startedAt: now, checkpointAt: now } })
        await tx.task.update({ where: { id: taskId }, data: { focusHeartbeatAt: now } })
        return { sessionId }
      })
    },
    async checkpoint(userId: bigint, sessionId: string, sequence: number, elapsedMs: number, pause: boolean) {
      return transact(userId, async tx => {
        const session = await tx.taskWorkSession.findFirst({ where: { id: sessionId, userId } })
        if (!session) throw new FocusError(404, 'Сессия не найдена')
        if (session.endedAt || sequence <= session.sequence) return { running: !session.endedAt, sequence: session.sequence }
        if (sequence !== session.sequence + 1) throw new FocusError(409, 'Нарушен порядок сессии. Запусти таймер заново')
        const now = new Date()
        const task = await tx.task.findUniqueOrThrow({ where: { id: session.taskId } })
        const interval = confirmedInterval(now.getTime() - session.checkpointAt.getTime(), elapsedMs)
        const lifeEndMs = LIFE_ENDS_MS.find(end => task.focusSpentMs < end) ?? BUDGET_MS
        const credit = Math.min(interval, lifeEndMs - task.focusSpentMs)
        const running = !pause && interval > 0 && !task.completed && !task.deletedAt && !task.isContainer && task.focusSpentMs + credit < lifeEndMs
        await tx.taskWorkSession.update({ where: { id: sessionId }, data: {
          sequence, checkpointAt: now, creditedMs: { increment: credit }, endedAt: running ? null : now,
        } })
        await tx.task.update({ where: { id: task.id }, data: {
          focusSpentMs: { increment: credit }, focusHeartbeatAt: running ? now : null,
        } })
        return { running, sequence }
      })
    },
    async pause(userId: bigint, taskId: string, sessionId?: string) {
      return transact(userId, async tx => {
        if (sessionId && !await tx.taskWorkSession.findFirst({ where: { id: sessionId, taskId, userId, endedAt: null } })) return
        await endSessions(tx, userId, [taskId])
      })
    },
    async split(userId: bigint, taskId: string, input: { children: { id: string; title: string }[] }) {
      return transact(userId, async tx => {
        const task = await tx.task.findFirst({ where: { id: taskId, userId, deletedAt: null } })
        if (!task) throw new FocusError(404, 'Задача не найдена')
        if (task.completed) throw new FocusError(409, 'Сначала открой задачу повторно')
        await assertAncestorsOpen(tx, task)
        if (!task.isContainer && task.focusSpentMs < BUDGET_MS) throw new FocusError(409, 'Разбиение доступно после 90 минут работы')
        if (!task.isContainer && input.children.length < 2) throw new FocusError(422, 'После 90 минут нужны минимум две подзадачи')
        // Child ids make retries idempotent, without accepting ids belonging to another task.
        const existing = await tx.task.findMany({ where: { id: { in: input.children.map(c => c.id) } } })
        if (existing.length) {
          if (existing.length === input.children.length && existing.every(t => t.userId === userId && t.parentTaskId === taskId)) return
          throw new FocusError(409, 'Подзадача с таким идентификатором уже существует')
        }
        await endSessions(tx, userId, [taskId])
        await tx.task.update({ where: { id: taskId }, data: { isContainer: true } })
        await tx.task.createMany({ data: input.children.map((child, index) => ({
          id: child.id || randomUUID(), userId, title: child.title, parentTaskId: taskId,
          columnId: task.columnId, dateKey: task.dateKey, recurrence: 'none', createdAtMs: BigInt(Date.now() + index),
        })) })
      })
    },
  }
}
