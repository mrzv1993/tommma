import assert from 'node:assert/strict'
import test from 'node:test'
import { activityCalendar, activityOpacity, type TaskActivity } from '../src/lib/task-activity.ts'

test('точные пороги прозрачности от нуля до девяти часов и насыщение выше', () => {
  assert.equal(activityOpacity(0), 0)
  assert.equal(activityOpacity(1), .1)
  for (let hour = 1; hour <= 9; hour++) {
    assert.equal(activityOpacity(hour * 3_600_000 - 1), hour / 10)
    assert.equal(activityOpacity(hour * 3_600_000), (hour + 1) / 10)
  }
  assert.equal(activityOpacity(24 * 3_600_000), 1)
  assert.equal(activityOpacity(-1), 0)
  assert.equal(activityOpacity(NaN), 0)
})

const activity = (startDate: string, endDate: string): TaskActivity => ({
  startDate, endDate, timeZone: 'UTC', generatedAt: `${endDate}T12:00:00Z`, dailyFocus: [{ date: endDate, focusMs: 3_600_000 }],
})

test('календарь показывает каждый день ровно один раз и скрывает будущие дни', () => {
  for (const [start, end, days] of [['2025-10-01', '2026-09-15', 350], ['2023-04-01', '2024-03-31', 366], ['2026-06-18', '2026-09-15', 90]] as const) {
    const calendar = activityCalendar(activity(start, end))
    const cells = calendar.flatMap(group => group.cells.filter(day => day.visible))
    assert.equal(cells.length, days)
    assert.equal(new Set(cells.map(day => day.date)).size, days)
    assert.equal(cells[0]?.date, start)
    assert.equal(cells.at(-1)?.date, end)
    assert.equal(cells.at(-1)?.focusMs, 3_600_000)
    for (const group of calendar) {
      assert.equal(group.cells.length, 42)
      assert.ok(group.cells.filter(day => day.inMonth).every(day => day.date.startsWith(group.key)))
      assert.equal(new Date(`${group.cells[0]!.date}T12:00:00Z`).getUTCDay(), 1)
    }
  }
})

test('месяцы идут по порядку через Новый год и содержат все дни февраля', () => {
  const months = activityCalendar(activity('2023-12-15', '2024-03-01'))
  assert.deepEqual(months.map(month => month.key), ['2023-12', '2024-01', '2024-02', '2024-03'])
  assert.equal(months[2]?.cells.filter(day => day.visible).length, 29)
  assert.equal(months.at(-1)?.cells.filter(day => day.visible).length, 1)
  assert.equal(months.at(-1)?.cells.filter(day => day.inMonth).length, 31)
})
