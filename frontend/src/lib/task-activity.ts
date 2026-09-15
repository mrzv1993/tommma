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
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' })
  const lastMonth = new Date(`${activity.endDate.slice(0, 7)}-01T12:00:00Z`)
  const monthCount = (lastMonth.getUTCFullYear() - firstMonth.getUTCFullYear()) * 12 + lastMonth.getUTCMonth() - firstMonth.getUTCMonth() + 1
  return Array.from({ length: Math.ceil(monthCount / 3) }, (_, index) => {
    const start = new Date(firstMonth)
    start.setUTCMonth(start.getUTCMonth() + index * 3)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 3)
    const monday = new Date(start)
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
    const count = Math.ceil((end.getTime() - monday.getTime()) / (7 * 86_400_000)) * 7
    const cells = Array.from({ length: count }, (_, dayIndex) => {
      const day = new Date(monday)
      day.setUTCDate(day.getUTCDate() + dayIndex)
      const date = day.toISOString().slice(0, 10)
      return { date, focusMs: values.get(date) ?? 0, visible: day >= start && day < end && date >= activity.startDate && date <= activity.endDate }
    })
    const months = Array.from({ length: Math.min(3, monthCount - index * 3) }, (_, monthIndex) => {
      const day = new Date(start)
      day.setUTCMonth(day.getUTCMonth() + monthIndex)
      return { label: monthLabel.format(day), column: Math.floor((day.getTime() - monday.getTime()) / (7 * 86_400_000)) + 1 }
    })
    return { key: start.toISOString(), cells, months, weeks: count / 7 }
  })
}
