export type TaskActivity = {
  startDate: string
  endDate: string
  timeZone: string
  generatedAt: string
  dailyFocus: { date: string; focusMs: number }[]
}

export function activityOpacity(focusMs: number) {
  if (!Number.isFinite(focusMs) || focusMs <= 0) return 0
  return Math.min(10, Math.floor(focusMs / 3_600_000) + 1) / 10
}

export function activityCalendar(activity: TaskActivity) {
  const firstMonth = new Date(`${activity.startDate.slice(0, 7)}-01T12:00:00Z`)
  const values = new Map(activity.dailyFocus.map(day => [day.date, day.focusMs]))
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const lastMonth = new Date(`${activity.endDate.slice(0, 7)}-01T12:00:00Z`)
  const monthCount = (lastMonth.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + lastMonth.getUTCMonth() - firstMonth.getUTCMonth() + 1
  return Array.from({ length: monthCount }, (_, index) => {
    const start = new Date(firstMonth)
    start.setUTCMonth(start.getUTCMonth() + index)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    const monday = new Date(start)
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
    // Six rows keep the slider height stable for every month.
    const cells = Array.from({ length: 42 }, (_, dayIndex) => {
      const day = new Date(monday)
      day.setUTCDate(day.getUTCDate() + dayIndex)
      const date = day.toISOString().slice(0, 10)
      const inMonth = day >= start && day < end
      return { date, day: day.getUTCDate(), inMonth, focusMs: values.get(date) ?? 0, visible: inMonth && date >= activity.startDate && date <= activity.endDate }
    })
    return { key: start.toISOString().slice(0, 7), label: monthLabel.format(start).replace(/ г\.$/, ''), cells }
  })
}
