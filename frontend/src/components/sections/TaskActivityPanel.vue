<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { RefreshCw } from '@lucide/vue'
import { api, ApiRequestError } from '@/lib/api'
import { activityCalendar, activityOpacity, type TaskActivity } from '@/lib/task-activity'
import { focusTimeLabel } from '@/lib/task-statistics'
import { useTaskFocus } from '@/app/task-focus-context'

const board = useTaskFocus()
const activity = ref<TaskActivity | null>(null)
const loading = ref(true)
const error = ref('')
const legacy = ref(false)
const selectedDate = ref('')
const expanded = ref(false)
let active = false
let revision = 0
let interval: ReturnType<typeof setInterval> | undefined
let refresh: ReturnType<typeof setTimeout> | undefined

async function load() {
  const request = ++revision
  loading.value = true
  error.value = ''
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  try {
    let result: TaskActivity
    let compatible = legacy.value
    try {
      if (compatible) result = (await api.getTaskStatistics(90, timeZone)).statistics
      else result = (await api.getTaskActivity(timeZone)).activity
    } catch (cause) {
      if (compatible || !(cause instanceof ApiRequestError) || cause.status !== 404) throw cause
      result = (await api.getTaskStatistics(90, timeZone)).statistics
      compatible = true
    }
    if (request !== revision) return
    activity.value = result
    legacy.value = compatible
  } catch {
    if (request === revision) error.value = 'Не удалось обновить активность.'
  } finally {
    if (request === revision) loading.value = false
  }
}

function resume() {
  if (active) return
  active = true
  legacy.value = false
  void load()
  interval = setInterval(() => { if (!document.hidden && !loading.value) void load() }, 30_000)
  document.addEventListener('visibilitychange', visible)
  window.addEventListener('online', visible)
}
function suspend() {
  active = false
  revision++
  clearInterval(interval)
  clearTimeout(refresh)
  document.removeEventListener('visibilitychange', visible)
  window.removeEventListener('online', visible)
}
function visible() { if (active && !document.hidden) void load() }
watch(() => board?.state.value.tasks.map(task => `${task.id}:${task.focusSpentMs}:${task.focusHeartbeatAt}:${task.deletedAt}`).join('|'), () => {
  if (!active) return
  clearTimeout(refresh)
  refresh = setTimeout(() => { if (!document.hidden) void load() }, 500)
})
onMounted(resume)
onActivated(resume)
onDeactivated(suspend)
onBeforeUnmount(suspend)

const calendar = computed(() => activity.value ? activityCalendar(activity.value) : [])
const todayMs = computed(() => activity.value?.dailyFocus.at(-1)?.focusMs ?? 0)
const selectedDay = computed(() => activity.value?.dailyFocus.find(day => day.date === selectedDate.value) ?? activity.value?.dailyFocus.at(-1))
const dateLabel = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const dayLabel = (day: { date: string; focusMs: number }) => `${dateLabel(day.date)}: ${focusTimeLabel(day.focusMs)}`
const yearLabel = computed(() => {
  if (!activity.value) return ''
  const start = activity.value.startDate.slice(0, 4), end = activity.value.endDate.slice(0, 4)
  return start === end ? end : `${start}–${end}`
})
</script>

<template>
  <aside class="task-activity-panel" :class="{ expanded }" aria-label="Активность по дням" :aria-busy="loading">
    <header class="activity-header">
      <h2>Активность</h2>
      <span>{{ yearLabel }}</span>
    </header>
    <div class="activity-today">
      <div><span>Сегодня</span><strong>{{ activity ? focusTimeLabel(todayMs) : '—' }}</strong></div>
      <button class="activity-toggle" type="button" :aria-expanded="expanded" aria-controls="task-activity-calendar" @click="expanded = !expanded">{{ expanded ? 'Свернуть' : 'Календарь' }}</button>
    </div>
    <p class="activity-caption">Время на задачи и подзадачи</p>
    <div v-if="error" class="activity-error" role="alert">
      <span>{{ error }}{{ activity ? ' Показаны последние данные.' : '' }}</span>
      <button type="button" :disabled="loading" @click="load"><RefreshCw aria-hidden="true" />Повторить</button>
    </div>
    <p v-if="loading && !activity" class="activity-loading" role="status">Загружаем активность…</p>
    <div v-if="activity" id="task-activity-calendar" class="activity-calendar">
      <div class="activity-period">{{ legacy ? 'Последние 90 дней' : 'Последние 12 месяцев' }}<span>По дням</span></div>
      <div class="activity-quarters">
        <div v-for="quarter in calendar" :key="quarter.key" class="activity-quarter" :style="{ '--weeks': quarter.weeks }">
          <div class="activity-months" aria-hidden="true"><span v-for="month in quarter.months" :key="month.column" :style="{ gridColumn: `${month.column} / span 3` }">{{ month.label }}</span></div>
          <div class="activity-days" role="group" aria-label="Дни активности">
            <template v-for="day in quarter.cells" :key="day.date">
              <button v-if="day.visible" type="button" class="activity-day" :class="{ today: day.date === activity.endDate, selected: day.date === selectedDate }"
                :style="{ '--activity-opacity': activityOpacity(day.focusMs) }" :aria-label="dayLabel(day)" :title="dayLabel(day)"
                :aria-pressed="day.date === selectedDate" :aria-current="day.date === activity.endDate ? 'date' : undefined"
                @mouseenter="selectedDate = day.date" @focus="selectedDate = day.date" @click="selectedDate = day.date"><span aria-hidden="true" /></button>
              <span v-else class="activity-day-spacer" aria-hidden="true" />
            </template>
          </div>
        </div>
      </div>
      <p class="activity-selection" aria-live="polite">{{ selectedDay ? dayLabel(selectedDay) : '' }}</p>
      <div class="activity-legend" aria-label="Шкала: от нуля до девяти часов и больше">
        <span>0</span><div aria-hidden="true"><i v-for="level in 11" :key="level" :style="{ '--activity-opacity': (level - 1) / 10 }"><span /></i></div><span>9+ ч</span>
      </div>
      <p v-if="!activity.dailyFocus.some(day => day.focusMs > 0)" class="activity-note">Запусти таймер задачи — здесь появится твоя активность.</p>
      <p v-if="legacy" class="activity-note">Время сессии учтено в день её начала.</p>
    </div>
  </aside>
</template>

<style scoped>
.task-activity-panel { min-width: 0; padding: 20px 18px; border: 1px solid #e0e5ed; border-radius: 14px; background: #fff; color: #3b4656; }
.activity-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.activity-header h2 { margin: 0; color: #242a31; font-size: 16px; font-weight: 700; letter-spacing: -.02em; }
.activity-header > span { color: #8994a6; font-size: 10px; }
.activity-today { display: flex; justify-content: space-between; align-items: center; margin-top: 22px; }
.activity-today > div { display: flex; flex-direction: column; gap: 5px; }
.activity-today span { color: #687489; font-size: 11px; }
.activity-today strong { color: #345aab; font-size: 27px; font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
.activity-caption { margin: 7px 0 22px; color: #8994a6; font-size: 10px; }
.activity-toggle { display: none; }
.activity-period { display: flex; justify-content: space-between; gap: 8px; padding-top: 16px; border-top: 1px solid #edf0f5; color: #687489; font-size: 10px; }
.activity-period > span { color: #8994a6; }
.activity-quarters { display: grid; gap: 19px; margin-top: 18px; }
.activity-months { display: grid; grid-template-columns: repeat(var(--weeks), minmax(0, 1fr)); gap: 3px; margin-bottom: 6px; color: #8994a6; font-size: 10px; line-height: 14px; }
.activity-days { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 1fr); grid-template-columns: repeat(var(--weeks), minmax(0, 1fr)); gap: 3px; }
.activity-day, .activity-day-spacer { min-width: 0; aspect-ratio: 1; }
.activity-day, .activity-legend i { position: relative; display: block; padding: 0; border: 0; border-radius: 3px; background: transparent; box-shadow: inset 0 0 0 1px #e9edf3; cursor: pointer; }
.activity-day > span, .activity-legend i > span { position: absolute; inset: 0; border-radius: inherit; background: #6585c9; opacity: var(--activity-opacity); }
.activity-day.today { outline: 1px solid #9baac4; outline-offset: 1px; }
.activity-day.selected, .activity-day:focus-visible { outline: 2px solid #345aab; outline-offset: 1px; z-index: 1; }
.activity-selection { min-height: 28px; margin: 17px 0 6px; color: #687489; font-size: 10px; line-height: 1.5; }
.activity-legend { display: flex; align-items: center; gap: 8px; color: #8994a6; font-size: 9px; white-space: nowrap; }
.activity-legend > div { display: flex; flex: 1; gap: 3px; }
.activity-legend i { flex: 1; aspect-ratio: 1; cursor: default; }
.activity-note { margin: 14px 0 0; color: #8994a6; font-size: 10px; line-height: 1.5; }
.activity-error { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 14px 0; color: #944d4d; font-size: 11px; line-height: 1.5; }
.activity-error button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #e0e5ed; background: #fff; color: #52637a; border-radius: 6px; padding: 5px 8px; font-size: 11px; cursor: pointer; }
.activity-error button:disabled { opacity: .5; cursor: default; }
.activity-error svg { width: 13px; height: 13px; }
.activity-loading { padding: 28px 0; font-size: 12px; color: #8994a6; }
button:focus-visible { outline: 2px solid #345aab; outline-offset: 2px; }
@media(max-width: 1100px) {
  .task-activity-panel { padding: 16px; }
  .activity-header { float: left; }
  .activity-header > span { display: none; }
  .activity-today { margin: 0; justify-content: flex-end; gap: 16px; }
  .activity-today > div { flex-direction: row; align-items: baseline; gap: 7px; }
  .activity-today strong { font-size: 18px; }
  .activity-toggle { display: block; padding: 4px 7px; color: #345aab; border: 1px solid #d8e1ef; background: #fff; border-radius: 5px; font-size: 11px; cursor: pointer; }
  .activity-caption { margin: 8px 0 0; }
  .activity-calendar { display: none; margin-top: 16px; }
  .expanded .activity-calendar { display: block; }
  .activity-quarters { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
  .activity-legend { max-width: 250px; }
}
@media(max-width: 480px) {
  .activity-header { float: none; margin-bottom: 12px; }
  .activity-today { justify-content: space-between; }
  .activity-quarters { grid-template-columns: 1fr; }
}
</style>
