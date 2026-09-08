import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient, Task } from '@prisma/client'

export const BUDGET_MS = 90 * 60_000
export const LIFE_ENDS_MS = [15 * 60_000, 45 * 60_000, BUDGET_MS]
export const livesLeft = (ms: number) => LIFE_ENDS_MS.filter(end => ms < end).length
export class FocusError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function lockTaskUser(tx: Prisma.TransactionClient, userId: bigint) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${userId})::text AS locked`
}
// Persist wall-clock time lazily, bounded by the current life. No heartbeat lease.
export async function accrueSessions(tx: Prisma.TransactionClient, userId: bigint, taskIds?: string[], stop = false, at = new Date()) {
  const sessions = await tx.taskWorkSession.findMany({ where: { userId, endedAt: null, ...(taskIds ? { taskId: { in: taskIds } } : {}) } })
  for (const session of sessions) {
    const task = await tx.task.findUniqueOrThrow({ where: { id: session.taskId } })
    const lifeEnd = LIFE_ENDS_MS.find(end => task.focusSpentMs < end) ?? BUDGET_MS
    const elapsed = Math.max(0, at.getTime() - session.checkpointAt.getTime())
    const credit = Math.min(elapsed, lifeEnd - task.focusSpentMs)
    const ended = stop || task.completed || !!task.deletedAt || task.isContainer || task.focusSpentMs + credit >= lifeEnd
    const checkpointAt = new Date(session.checkpointAt.getTime() + credit)
    await tx.taskWorkSession.update({ where: { id: session.id }, data: {
      creditedMs: { increment: credit }, checkpointAt, endedAt: ended ? checkpointAt : null,
    } })
    await tx.task.update({ where: { id: task.id }, data: {
      focusSpentMs: { increment: credit }, focusHeartbeatAt: ended ? null : checkpointAt,
    } })
  }
}
export async function endSessions(tx: Prisma.TransactionClient, userId: bigint, taskIds?: string[]) {
  await accrueSessions(tx, userId, taskIds, true)
}
// Kept as the read-path reconciliation entrypoint; sessions expire only at a life boundary.
export async function expireSessions(tx: Prisma.TransactionClient, userId: bigint) {
  await accrueSessions(tx, userId)
}
export async function focusSnapshot(tx: Prisma.TransactionClient, userId: bigint) {
  const session = await tx.taskWorkSession.findFirst({ where: { userId, endedAt: null } })
  if (!session) return null
  const task = await tx.task.findUniqueOrThrow({ where: { id: session.taskId } })
  return { id: session.id, taskId: task.id, sequence: session.sequence, spentMs: task.focusSpentMs,
    at: session.checkpointAt.getTime(), lifeEndMs: LIFE_ENDS_MS.find(end => task.focusSpentMs < end) ?? BUDGET_MS }
}
async function pauseSession(tx: Prisma.TransactionClient, userId: bigint, taskId: string, sessionId?: string, pausedAt?: number) {
  if (!sessionId) { await endSessions(tx, userId, [taskId]); return }
  const session = await tx.taskWorkSession.findFirst({ where: { id: sessionId, taskId, userId } })
  if (!session || (session.endedAt && pausedAt === undefined)) return
  const newer = await tx.taskWorkSession.findFirst({ where: { taskId, userId, startedAt: { gt: session.startedAt } } })
  if (newer) return
  const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } })
  if (task.completed || task.deletedAt || task.isContainer) return
  const base = task.focusSpentMs - session.creditedMs
  const lifeEnd = LIFE_ENDS_MS.find(end => base < end) ?? BUDGET_MS
  const stopAt = Math.max(session.startedAt.getTime(), Math.min(pausedAt ?? Date.now(), Date.now(), session.endedAt?.getTime() ?? Infinity))
  const creditedMs = Math.min(lifeEnd - base, stopAt - session.startedAt.getTime())
  const endedAt = new Date(session.startedAt.getTime() + creditedMs)
  await tx.taskWorkSession.update({ where: { id: session.id }, data: { creditedMs, checkpointAt: endedAt, endedAt } })
  await tx.task.update({ where: { id: taskId }, data: { focusSpentMs: base + creditedMs, focusHeartbeatAt: null } })
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
export function createTaskFocus(prisma: PrismaClient) {
  const transact = <T>(userId: bigint, fn: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
    await lockTaskUser(tx, userId)
    return fn(tx)
  })
  return {
    async start(userId: bigint, taskId: string, sessionId: string) {
      return transact(userId, async tx => {
        await expireSessions(tx, userId)
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
    async checkpoint(userId: bigint, sessionId: string, sequence: number, _elapsedMs: number, pause: boolean, pausedAt?: number) {
      return transact(userId, async tx => {
        const session = await tx.taskWorkSession.findFirst({ where: { id: sessionId, userId } })
        if (!session) throw new FocusError(404, 'Сессия не найдена')
        if (pause) await pauseSession(tx, userId, session.taskId, sessionId, pausedAt)
        else await expireSessions(tx, userId)
        const updated = await tx.taskWorkSession.findUniqueOrThrow({ where: { id: sessionId } })
        // Sequence is informational; retries/other tabs cannot double-count wall time.
        const nextSequence = Math.max(updated.sequence, sequence)
        await tx.taskWorkSession.update({ where: { id: sessionId }, data: { sequence: nextSequence } })
        return { running: !updated.endedAt, sequence: nextSequence }
      })
    },
    async pause(userId: bigint, taskId: string, sessionId?: string, pausedAt?: number) {
      return transact(userId, tx => pauseSession(tx, userId, taskId, sessionId, pausedAt))
    },
    async split(userId: bigint, taskId: string, input: { children: { id: string; title: string }[] }) {
      return transact(userId, async tx => {
        await expireSessions(tx, userId)
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
