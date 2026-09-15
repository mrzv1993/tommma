import assert from 'node:assert/strict'
import test from 'node:test'
import { activityCalendar, activityOpacity, activityTimeLabel, projectActivityFocus, type TaskActivity } from '../src/lib/task-activity.ts'

test('время сегодня: 00:сс, мм:сс и ч:мм:сс без нулевых часов', () => {
  for (const [ms, label] of [[0, '00:00'], [8000, '00:08'], [59999, '00:59'], [60000, '01:00'], [95999, '01:35'], [3599999, '59:59'], [3600000, '1:00:00'], [3661000, '1:01:01'], [36001000, '10:00:01'], [-1, '00:00'], [NaN, '00:00']] as const) {
    assert.equal(activityTimeLabel(ms), label)
  }
})

test('живое время суммирует приращения задач, сохраняет паузу и не удваивает синхронизацию', () => {
  const samples = (task: number, child: number) => [{ id: 'task', spentMs: task }, { id: 'child', spentMs: child }]
  const anchor = { focusMs: 120000, samples: samples(900000, 10000) }
  assert.equal(projectActivityFocus(anchor, samples(901000, 10000)), 121000)
  assert.equal(projectActivityFocus(anchor, samples(902000, 10000)), 122000)
  // A paused task keeps its frozen value while another task starts.
  assert.equal(projectActivityFocus(anchor, samples(902000, 10000)), 122000)
  assert.equal(projectActivityFocus(anchor, samples(902000, 11000)), 123000)
  const refreshed = { focusMs: 123000, samples: samples(902000, 11000) }
  assert.equal(projectActivityFocus(refreshed, samples(902000, 12000)), 124000)
  // A historical task arriving or disappearing must not change today's total.
  assert.equal(projectActivityFocus(refreshed, [...samples(902000, 11000), { id: 'loaded', spentMs: 5400000 }]), 123000)
  assert.equal(projectActivityFocus(refreshed, [{ id: 'child', spentMs: 11000 }]), 123000)
  assert.equal(projectActivityFocus(refreshed, samples(901000, 11000)), 122000)
})

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
