import type { PrismaClient } from '@prisma/client'
import { BUDGET_MS, LIFE_ENDS_MS } from './task-focus.js'
import { dateInZone, statisticsDays } from './task-statistics.js'

export function activityRange(now: Date, timeZone: string) {
  const endDate = dateInZone(now, timeZone)
  const start = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`)
  start.setUTCMonth(start.getUTCMonth() - 11)
  const startDate = start.toISOString().slice(0, 10)
  const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - start.getTime()) / 86_400_000) + 1
  return { startDate, endDate, dates: statisticsDays(endDate, days) }
}

// Sessions are continuous intervals: each manual resume creates a new session.
// Find local midnight by its date key, so DST days need not be exactly 24 hours.
export function dailyActivity(dates: string[], sessions: { startedAt: Date; creditedMs: number }[], timeZone: string) {
  const dailyFocus = dates.map(date => ({ date, focusMs: 0 }))
  const byDate = new Map(dailyFocus.map(day => [day.date, day]))
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateKey = (at: number) => {
    const parts = formatter.formatToParts(at)
    const part = (type: string) => parts.find(item => item.type === type)!.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
  for (const session of sessions) {
    let cursor = session.startedAt.getTime()
    const end = cursor + Math.max(0, session.creditedMs)
    while (cursor < end) {
      const key = dateKey(cursor)
      let boundary = end
      if (dateKey(end - 1) !== key) {
        let low = cursor + 1, high = end
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (dateKey(middle) === key) low = middle + 1
          else high = middle
        }
        boundary = low
      }
      const day = byDate.get(key)
      if (day) day.focusMs += boundary - cursor
      cursor = boundary
    }
  }
  return dailyFocus
}

export async function getTaskActivity(prisma: PrismaClient, userId: bigint, timeZone: string, now = new Date()) {
  const { startDate, endDate, dates } = activityRange(now, timeZone)
  // Include sessions beginning just before the first local day (maximum 90m).
  const from = new Date(Date.parse(`${startDate}T00:00:00Z`) - 14 * 3_600_000 - BUDGET_MS)
  const sessions = await prisma.$transaction(tx => tx.taskWorkSession.findMany({
    where: { userId, task: { userId, deletedAt: null }, startedAt: { gte: from, lte: now } },
    select: {
      startedAt: true, checkpointAt: true, endedAt: true, creditedMs: true,
      task: { select: { focusSpentMs: true, completed: true, isContainer: true } },
    },
  }), { isolationLevel: 'RepeatableRead' })
  const intervals = sessions.map(session => {
    const lifeEnd = LIFE_ENDS_MS.find(end => session.task.focusSpentMs < end) ?? BUDGET_MS
    const runningMs = !session.endedAt && !session.task.completed && !session.task.isContainer
      ? Math.min(Math.max(0, now.getTime() - session.checkpointAt.getTime()), Math.max(0, lifeEnd - session.task.focusSpentMs))
      : 0
    return { startedAt: session.startedAt, creditedMs: session.creditedMs + runningMs }
  })
  const dailyFocus = dailyActivity(dates, intervals, timeZone)
  return { startDate, endDate, timeZone, generatedAt: now.toISOString(), dailyFocus }
}
