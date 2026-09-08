import type { PrismaClient } from '@prisma/client'
import { BUDGET_MS, lockTaskUser, expireSessions } from './task-focus.js'

export function dateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string) => parts.find(p => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function statisticsDays(endDate: string, days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(`${endDate}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - days + index + 1)
    return date.toISOString().slice(0, 10)
  })
}
export const completionLife = (ms: number) => ms < 900_000 ? 1 : ms < 2_700_000 ? 2 : 3

export async function getTaskStatistics(prisma: PrismaClient, userId: bigint, days: number, timeZone: string, now = new Date()) {
  await prisma.$transaction(async tx => { await lockTaskUser(tx, userId); await expireSessions(tx, userId) })
  const dates = statisticsDays(dateInZone(now, timeZone), days)
  // Read a slightly wider UTC window, then select local calendar days. This
  // handles DST and UTC offsets without treating a local day as exactly 24h.
  const from = new Date(Date.parse(`${dates[0]}T00:00:00Z`) - 14 * 3_600_000)
  const inPeriod = (date: Date) => {
    const key = dateInZone(date, timeZone)
    return key >= dates[0]! && key <= dates.at(-1)!
  }
  const [sessions, completedRows, exhaustedTasks, undatedCompletedCount] = await prisma.$transaction([
    prisma.taskWorkSession.findMany({
      where: { userId, task: { userId, deletedAt: null }, startedAt: { gte: from, lte: now }, creditedMs: { gt: 0 } },
      select: { startedAt: true, creditedMs: true },
    }),
    prisma.task.findMany({
      where: { userId, completed: true, deletedAt: null, isContainer: false, completedAt: { gte: from, lte: now } },
      select: { id: true, title: true, completedAt: true, completionFocusMs: true },
      orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
    }),
    prisma.task.findMany({
      where: { userId, completed: false, deletedAt: null, isContainer: false, focusSpentMs: { gte: BUDGET_MS } },
      select: { id: true, title: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    }),
    prisma.task.count({ where: { userId, completed: true, deletedAt: null, isContainer: false, completedAt: null } }),
  ], { isolationLevel: 'RepeatableRead' })
  const dailyFocus = dates.map(date => ({ date, focusMs: 0 }))
  const byDate = new Map(dailyFocus.map(day => [day.date, day]))
  for (const session of sessions) {
    const day = byDate.get(dateInZone(session.startedAt, timeZone))
    if (day) day.focusMs += session.creditedMs
  }
  const completedTasks = completedRows.filter(task => inPeriod(task.completedAt!)).map(task => ({
    id: task.id, title: task.title, completedAt: task.completedAt!.toISOString(),
    focusMs: task.completionFocusMs, life: task.completionFocusMs === null ? null : completionLife(task.completionFocusMs),
  }))
  const lifeDistribution = [1, 2, 3].map(life => ({ life, count: completedTasks.filter(task => task.life === life).length }))
  const classifiedCompletedCount = lifeDistribution.reduce((sum, item) => sum + item.count, 0)
  return {
    days, timeZone, startDate: dates[0]!, endDate: dates.at(-1)!, generatedAt: now.toISOString(),
    focusMs: dailyFocus.reduce((sum, day) => sum + day.focusMs, 0),
    completedCount: completedTasks.length, classifiedCompletedCount, lifeDistribution,
    dailyFocus, completedTasks, exhaustedTasks, undatedCompletedCount,
  }
}
