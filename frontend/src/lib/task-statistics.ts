export type StatisticsPeriod = 7 | 30 | 90
export type TaskStatistics = {
  days: StatisticsPeriod
  timeZone: string
  startDate: string
  endDate: string
  generatedAt: string
  focusMs: number
  completedCount: number
  classifiedCompletedCount: number
  undatedCompletedCount: number
  dailyFocus: { date: string; focusMs: number }[]
  lifeDistribution: { life: number; count: number }[]
  completedTasks: { id: string; title: string; completedAt: string; focusMs: number | null; life: number | null }[]
  exhaustedTasks: { id: string; title: string }[]
}
export function focusTimeLabel(ms: number) {
  if (ms > 0 && ms < 60_000) return `${Math.floor(ms / 1000)} сек`
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}` : `${minutes} мин`
}
export function percentage(count: number, total: number) {
  return total > 0 ? Math.round(count * 100 / total) : 0
}
