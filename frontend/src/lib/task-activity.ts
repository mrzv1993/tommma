export type TaskActivity = {
  startDate: string
  endDate: string
  timeZone: string
  generatedAt: string
  dailyFocus: { date: string; focusMs: number }[]
}

export type ActivityFocusSample = { id: string; spentMs: number }
export type ActivityFocusAnchor = { focusMs: number; samples: ActivityFocusSample[] }

export function activityTimeLabel(ms: number) {
  const seconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const hours = Math.floor(seconds / 3600)
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, '0')
  const remainder = String(seconds % 60).padStart(2, '0')
  return `${hours ? `${hours}:` : ''}${minutes}:${remainder}`
}

// Rebase on every server response. Only changes since that snapshot are added,
// never the task's lifetime total or the aggregate total of a parent container.
export function projectActivityFocus(anchor: ActivityFocusAnchor, samples: ActivityFocusSample[]) {
  const baselines = new Map(anchor.samples.map(sample => [sample.id, sample.spentMs]))
  return Math.max(0, samples.reduce((total, sample) => {
    const baseline = baselines.get(sample.id)
    return total + (baseline === undefined ? 0 : sample.spentMs - baseline)
  }, anchor.focusMs))
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
