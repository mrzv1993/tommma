<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, CalendarDays, CheckCircle2, ListTree, RefreshCw } from '@lucide/vue'
import { api, ApiRequestError } from '@/lib/api'
import { focusTimeLabel, percentage, type StatisticsPeriod, type TaskStatistics } from '@/lib/task-statistics'
import { useTaskFocus } from '@/app/task-focus-context'
import TaskSubtasks from '@/components/tasks/TaskSubtasks.vue'
import { livesLeft } from '@/lib/task-focus'

const emit = defineEmits<{ back: [] }>()
const board = useTaskFocus()
const period = ref<StatisticsPeriod>(7)
const statistics = ref<TaskStatistics | null>(null)
const loading = ref(true)
const error = ref('')
const showExhausted = ref(false)
const visibleCompleted = ref(5)
const selectedBucket = ref<number | null>(null)
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
let requestRevision = 0
let interval: ReturnType<typeof setInterval> | undefined

async function load() {
  const revision = ++requestRevision
  loading.value = true
  error.value = ''
  try {
    const result = await api.getTaskStatistics(period.value, timeZone)
    if (revision === requestRevision) statistics.value = result.statistics
  } catch (cause) {
    if (revision !== requestRevision) return
    error.value = cause instanceof ApiRequestError && cause.status === 404
      ? 'Статистика появится после обновления Tommma на сервере.'
      : 'Не удалось загрузить статистику. Проверь соединение и попробуй ещё раз.'
  } finally { if (revision === requestRevision) loading.value = false }
}
watch(period, () => { statistics.value = null; visibleCompleted.value = 5; selectedBucket.value = null; void load() })
watch(() => board?.splitTaskId.value, (next, previous) => { if (previous && !next) void load() })
onMounted(() => { void load(); interval = setInterval(() => { if (!document.hidden && !loading.value) void load() }, 30_000) })
onBeforeUnmount(() => { requestRevision++; clearInterval(interval) })

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) =>
  new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
const completedDate = (date: string) => new Intl.DateTimeFormat('ru-RU', { timeZone, day: 'numeric', month: 'long' }).format(new Date(date))
const completionHearts = (ms: number | null) => '❤️'.repeat(livesLeft(ms ?? 0)) + '🖤'.repeat(3 - livesLeft(ms ?? 0))
const rangeLabel = computed(() => statistics.value ? `${dateLabel(statistics.value.startDate)} — ${dateLabel(statistics.value.endDate, { day: 'numeric', month: 'long', year: 'numeric' })}` : '')
const firstLife = computed(() => statistics.value?.lifeDistribution.find(row => row.life === 1)?.count ?? 0)
const firstLifePercent = computed(() => percentage(firstLife.value, statistics.value?.classifiedCompletedCount ?? 0))
const buckets = computed(() => {
  const rows = statistics.value?.dailyFocus ?? []
  const step = period.value === 7 ? 1 : 7
  return Array.from({ length: Math.ceil(rows.length / step) }, (_, index) => {
    const group = rows.slice(index * step, (index + 1) * step)
    return { date: group[0]!.date, end: group.at(-1)!.date, focusMs: group.reduce((sum, day) => sum + day.focusMs, 0) }
  })
})
const chartMax = computed(() => Math.max(3_600_000, Math.ceil(Math.max(0, ...buckets.value.map(day => day.focusMs)) / 1_800_000) * 1_800_000))
const highlightedBucket = computed(() => buckets.value[selectedBucket.value ?? buckets.value.length - 1])
async function openSplit(taskId: string) {
  if (!board) return
  if (!board.state.value.tasks.some(task => task.id === taskId)) {
    try { await board.syncFromServer() } catch { error.value = 'Не удалось загрузить задачу для разбиения.'; return }
  }
  if (board.state.value.tasks.some(task => task.id === taskId)) board.splitTaskId.value = taskId
  else { error.value = 'Задача уже изменилась. Обнови статистику.'; void load() }
}
</script>

<template>
  <section class="statistics-screen" aria-label="Статистика задач" :aria-busy="loading">
    <header class="statistics-header">
      <div>
        <button class="back-link" type="button" @click="emit('back')"><ArrowLeft aria-hidden="true" />К приоритетам</button>
        <h1>Статистика</h1>
      </div>
      <div class="period-controls">
        <div class="period-tabs" role="group" aria-label="Период статистики">
          <button v-for="days in ([7, 30, 90] as const)" :key="days" type="button" :aria-pressed="period === days" :class="{ selected: period === days }" @click="period = days">{{ days }} дней</button>
        </div>
        <p class="date-range"><CalendarDays aria-hidden="true" /><span>{{ rangeLabel || 'Последние ' + period + ' дней' }}</span></p>
      </div>
    </header>

    <div v-if="error" class="statistics-error" role="alert">
      <span>{{ error }}</span><button type="button" :disabled="loading" @click="load"><RefreshCw aria-hidden="true" />Повторить</button>
    </div>
    <div v-if="loading && !statistics" class="statistics-loading" role="status">Загружаем статистику…</div>
    <template v-if="statistics">
      <div class="statistics-kpis">
        <article><h2>Время фокуса</h2><strong class="focus-total">{{ focusTimeLabel(statistics.focusMs) }}</strong><p>За выбранный период</p></article>
        <article><h2>Завершено задач</h2><strong>{{ statistics.completedCount }}</strong><p>Задачи и подзадачи</p></article>
        <article><h2>На первой жизни</h2><strong>{{ statistics.classifiedCompletedCount ? firstLifePercent + '%' : '—' }}</strong><p>{{ firstLife }} из {{ statistics.classifiedCompletedCount }} задач</p></article>
        <article><h2>Нужны подзадачи</h2><strong>{{ statistics.exhaustedTasks.length }}</strong><p>Все жизни израсходованы · сейчас</p></article>
      </div>

      <div class="statistics-charts">
        <article class="focus-chart">
          <div class="block-heading"><h2>{{ period === 7 ? 'Фокус по дням' : 'Фокус по неделям' }}</h2><span>Всего {{ focusTimeLabel(statistics.focusMs) }}</span></div>
          <div class="chart" :class="{ 'many-bars': buckets.length > 7 }" aria-label="График времени фокуса">
            <div v-for="ratio in [0, .5, 1]" :key="ratio" class="chart-gridline" :style="{ bottom: `${ratio * 100}%` }"><span>{{ ratio ? focusTimeLabel(chartMax * ratio) : '0' }}</span></div>
            <div class="chart-bars">
              <button v-for="(bucket, index) in buckets" :key="bucket.date" type="button" class="chart-column" :class="{ highlighted: index === (selectedBucket ?? buckets.length - 1) }" :aria-label="`${dateLabel(bucket.date)}${bucket.end !== bucket.date ? ' — ' + dateLabel(bucket.end) : ''}: ${focusTimeLabel(bucket.focusMs)}`" @focus="selectedBucket = index" @click="selectedBucket = index" @mouseenter="selectedBucket = index">
                <span class="bar-fill" :style="{ height: `${bucket.focusMs / chartMax * 100}%` }"><span v-if="bucket.focusMs" class="bar-value">{{ focusTimeLabel(bucket.focusMs) }}</span></span>
                <span class="bar-label"><span v-if="period === 7">{{ dateLabel(bucket.date, { weekday: 'short' }) }}</span><span>{{ dateLabel(bucket.date, { day: 'numeric', ...(period === 7 ? {} : { month: 'numeric' }) }) }}</span><small v-if="period === 7 && bucket.date === statistics.endDate">Сегодня</small></span>
              </button>
            </div>
          </div>
          <p v-if="period !== 7" class="chart-selection" aria-live="polite">{{ highlightedBucket ? dateLabel(highlightedBucket.date) + (highlightedBucket.end !== highlightedBucket.date ? ' — ' + dateLabel(highlightedBucket.end) : '') + ': ' + focusTimeLabel(highlightedBucket.focusMs) : '' }}</p>
        </article>

        <article class="life-chart">
          <h2>На какой жизни завершены</h2><p class="block-caption">{{ statistics.classifiedCompletedCount ? 'Задач с учтёнными жизнями: ' + statistics.classifiedCompletedCount : 'За этот период ещё нет завершённых задач' }}</p>
          <div class="life-distribution">
            <div v-for="row in statistics.lifeDistribution" :key="row.life" class="life-distribution-row">
              <span class="life-symbol" aria-hidden="true">❤️</span><span>{{ row.life }}-я жизнь</span>
              <div class="life-track" role="progressbar" :aria-label="`${row.life}-я жизнь: ${row.count} задач`" :aria-valuenow="percentage(row.count, statistics.classifiedCompletedCount)" :aria-valuemin="0" :aria-valuemax="100"><span :style="{ width: percentage(row.count, statistics.classifiedCompletedCount) + '%' }" /></div>
              <strong>{{ row.count }}</strong><span class="life-percent">{{ percentage(row.count, statistics.classifiedCompletedCount) }}%</span>
            </div>
          </div>
          <div class="exhausted-summary">
            <span class="exhausted-hearts" aria-hidden="true">🖤🖤🖤</span>
            <div><strong>{{ statistics.exhaustedTasks.length ? 'Задач без жизней: ' + statistics.exhaustedTasks.length : 'Нет задач без жизней' }}</strong><p>{{ statistics.exhaustedTasks.length ? '90 минут прошли — пора разбить работу на шаги' : 'Все текущие задачи укладываются в бюджет' }}</p></div>
            <button v-if="statistics.exhaustedTasks.length" class="primary-button" type="button" :aria-expanded="showExhausted" @click="showExhausted = !showExhausted"><ListTree aria-hidden="true" />Разбить на подзадачи</button>
          </div>
          <ul v-if="statistics.exhaustedTasks.length" v-show="showExhausted" class="exhausted-list" aria-label="Задачи для разбиения">
            <li v-for="task in statistics.exhaustedTasks" :key="task.id"><span>{{ task.title }}</span><button type="button" :aria-label="`Разбить на подзадачи: ${task.title}`" @click="openSplit(task.id)"><ListTree aria-hidden="true" />Разбить</button><TaskSubtasks v-if="board?.splitTaskId.value === task.id" :parent-task-id="task.id" /></li>
          </ul>
        </article>
      </div>

      <article class="completed-statistics">
        <div class="block-heading"><h2>Последние завершённые задачи</h2><span>{{ Math.min(visibleCompleted, statistics.completedCount) }} из {{ statistics.completedCount }}</span></div>
        <p v-if="!statistics.completedTasks.length" class="statistics-empty">Заверши первую задачу — здесь появятся её время и использованные жизни.</p>
        <table v-else>
          <thead><tr><th>Задача</th><th>Время фокуса</th><th>Жизнь при завершении</th><th>Завершена</th></tr></thead>
          <tbody><tr v-for="task in statistics.completedTasks.slice(0, visibleCompleted)" :key="task.id">
            <td class="completed-title"><CheckCircle2 aria-hidden="true" /><span>{{ task.title }}</span></td>
            <td data-label="Время фокуса">{{ task.focusMs === null ? '—' : focusTimeLabel(task.focusMs) }}</td>
            <td data-label="Завершена на"><span v-if="task.life" class="completion-life"><span class="completion-hearts" aria-hidden="true">{{ completionHearts(task.focusMs) }}</span><span>{{ task.life }}-я жизнь</span></span><span v-else>Не учтена</span></td>
            <td data-label="Дата">{{ completedDate(task.completedAt) }}</td>
          </tr></tbody>
        </table>
        <button v-if="statistics.completedTasks.length > visibleCompleted" type="button" class="more-button" @click="visibleCompleted += 10">Показать ещё</button>
        <p v-if="statistics.undatedCompletedCount" class="statistics-note historical-note">У {{ statistics.undatedCompletedCount }} ранее завершённых задач дата завершения не сохранена. Они не включены в выбранный период.</p>
        <p class="statistics-note">Время сессии учитывается в день её начала. Паузы не входят.</p>
      </article>
    </template>
  </section>
</template>

<style scoped>
.statistics-screen { --stats-blue: #164dff; --stats-ink: #101b38; --stats-muted: #5d6880; --stats-line: #dce1ea; flex: 1; min-width: 0; padding: 28px 36px 36px 100px; color: var(--stats-ink); background: #fff; font-family: Inter,sans-serif; overflow-y: auto; }
.statistics-header { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
h1,h2,p { margin: 0; } h1 { font-size: 42px; letter-spacing: -1.5px; line-height: 1.15; } h2 { font-size: 18px; line-height: 1.35; font-weight: 700; }
button { font: inherit; cursor: pointer; } button:focus-visible { outline: 2px solid var(--stats-blue); outline-offset: 4px; } button:disabled { cursor: wait; opacity: .6; }
.back-link { display: inline-flex; align-items: center; gap: 6px; padding: 0; margin-bottom: 12px; border: 0; background: none; color: var(--stats-muted); font-size: 12px; }.back-link svg { width: 14px; height: 14px; }
.period-controls { align-self: flex-start; padding-top: 4px; }.period-tabs { display: flex; border-bottom: 2px solid #e8ebf0; }.period-tabs button { min-width: 90px; padding: 8px 12px 10px; border: 0; background: none; color: var(--stats-muted); margin-bottom: -2px; border-bottom: 3px solid transparent; font-size: 14px; }.period-tabs button.selected { color: var(--stats-blue); border-bottom-color: currentColor; font-weight: 700; }
.date-range { display: flex; align-items: center; justify-content: flex-end; gap: 9px; margin-top: 16px; font-size: 13px; }.date-range svg { width: 20px; height: 20px; color: var(--stats-muted); }
.statistics-kpis { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); padding: 6px 0 26px; border-bottom: 1px solid var(--stats-line); }.statistics-kpis article { padding: 0 28px; border-left: 1px solid var(--stats-line); }.statistics-kpis article:first-child { padding-left: 0; border: 0; }.statistics-kpis h2 { font-size: 13px; font-weight: 500; margin-bottom: 12px; }.statistics-kpis strong { display: block; font-size: clamp(30px,3.3vw,48px); font-weight: 600; letter-spacing: -1px; line-height: 1.15; }.statistics-kpis .focus-total { color: var(--stats-blue); font-size: clamp(26px,2.7vw,42px); }.statistics-kpis p { font-size: 12px; color: var(--stats-muted); margin-top: 9px; }
.statistics-charts { display: grid; grid-template-columns: 1fr 1.08fr; padding: 26px 0; border-bottom: 1px solid var(--stats-line); }.focus-chart { min-width: 0; padding-right: 28px; }.life-chart { min-width: 0; padding-left: 28px; border-left: 1px solid var(--stats-line); }.block-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }.block-heading > span,.block-caption { color: var(--stats-muted); font-size: 12px; }.block-caption { margin-top: 6px; }
.chart { position: relative; height: 190px; margin: 58px 0 64px 35px; }.chart-gridline { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--stats-line); }.chart-gridline:first-child { border-top-style: solid; border-color: #9da6b9; }.chart-gridline > span { position: absolute; top: -8px; right: calc(100% + 10px); color: var(--stats-muted); font-size: 11px; white-space: nowrap; }.chart-bars { height: 100%; display: flex; gap: 14px; padding: 0 9px; position: relative; }.chart-column { flex: 1; min-width: 0; position: relative; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; padding: 0; border: 0; border-radius: 0; background: none; color: var(--stats-ink); }.bar-fill { position: relative; display: block; width: 100%; min-height: 2px; background: var(--stats-blue); }.highlighted .bar-fill { background: #1034ba; }.bar-value { position: absolute; bottom: calc(100% + 9px); left: 50%; transform: translateX(-50%); font-size: 10px; font-weight: 600; white-space: nowrap; }.bar-label { position: absolute; top: calc(100% + 10px); width: 100%; display: flex; flex-direction: column; gap: 4px; font-size: 11px; text-transform: capitalize; }.bar-label small { font-size: 10px; white-space: nowrap; align-self: center; }.highlighted .bar-label { color: var(--stats-blue); font-weight: 600; }.many-bars .bar-value { display: none; }.many-bars .chart-bars { gap: 7px; }.many-bars .bar-label { font-size: 9px; }
.chart-selection { font-size: 12px; color: var(--stats-muted); min-height: 18px; }.statistics-note { color: var(--stats-muted); font-size: 11px; line-height: 1.5; margin-top: 7px; }
.life-distribution { display: grid; gap: 30px; padding: 32px 0; }.life-distribution-row { display: grid; grid-template-columns: 24px 82px minmax(40px,1fr) 25px 36px; align-items: center; gap: 12px; font-size: 13px; }.life-symbol { font-size: 20px; }.life-track { background: #f0f2f6; border-radius: 5px; height: 9px; overflow: hidden; }.life-track > span { display: block; height: 100%; background: var(--stats-blue); border-radius: inherit; }.life-distribution-row strong { font-size: 18px; font-weight: 500; text-align: right; }.life-percent { text-align: right; }
.exhausted-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; border-top: 1px solid var(--stats-line); padding-top: 22px; }.exhausted-hearts { font-size: 17px; white-space: nowrap; }.exhausted-summary > div { flex: 1; min-width: 180px; }.exhausted-summary strong { font-size: 12px; }.exhausted-summary p { font-size: 11px; color: var(--stats-muted); margin-top: 6px; line-height: 1.5; }.primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 13px; background: var(--stats-blue); border: 0; border-radius: 5px; color: #fff; font-size: 11px; font-weight: 600; }.primary-button svg { width: 18px; height: 18px; }
.exhausted-list { list-style: none; margin: 16px 0 0; padding: 0; }.exhausted-list > li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--stats-line); font-size: 12px; }.exhausted-list > li > span { overflow-wrap: anywhere; }.exhausted-list > li > button,.statistics-error button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--stats-line); border-radius: 5px; color: var(--stats-blue); background: #fff; white-space: nowrap; }.exhausted-list svg,.statistics-error svg { width: 15px; height: 15px; }
.completed-statistics { margin-top: 20px; }.completed-statistics table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 8px; font-size: 13px; }.completed-statistics th { color: var(--stats-muted); font-size: 10px; font-weight: 500; text-align: left; padding: 10px 8px; }.completed-statistics td { border-top: 1px solid var(--stats-line); padding: 14px 8px; }.completed-statistics th:first-child { width: 43%; padding-left: 0; }.completed-statistics th:nth-child(2) { width: 15%; }.completed-statistics th:nth-child(3) { width: 28%; }.completed-title { position: relative; padding-left: 32px !important; overflow-wrap: anywhere; }.completed-title svg { width: 18px; height: 18px; position: absolute; left: 0; top: 14px; color: var(--stats-blue); }.completion-life { display: inline-flex; align-items: center; gap: 14px; font-size: 11px; }.completion-hearts { font-size: 14px; white-space: nowrap; }.statistics-empty { padding: 28px 0; color: var(--stats-muted); font-size: 13px; }.historical-note { padding-top: 14px; border-top: 1px solid var(--stats-line); }.more-button { display: block; margin: 16px auto; border: 0; background: none; color: var(--stats-blue); font-size: 12px; }
.statistics-loading { padding: 60px 0; color: var(--stats-muted); text-align: center; }.statistics-error { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 16px; margin-bottom: 20px; border: 1px solid #e2caca; border-radius: 8px; background: #fff7f7; color: #8c3434; font-size: 13px; }
@media(min-width:1450px) { .statistics-screen { padding-left: 120px; }.statistics-charts { grid-template-columns: 1fr 1.12fr; }.chart { height: 215px; }.life-distribution { gap: 38px; padding: 38px 0; } }
@media(max-width:1050px) { .statistics-screen { padding-right: 24px; }.statistics-kpis article { padding: 0 16px; }.statistics-charts { grid-template-columns: 1fr; gap: 28px; }.focus-chart { padding: 0; }.life-chart { padding: 24px 0 0; border-left: 0; border-top: 1px solid var(--stats-line); }.chart { height: 200px; }.life-distribution { gap: 22px; }.bar-value { font-size: 11px; } }
@media(max-width:760px) { .statistics-screen { padding: 70px 16px 28px; }.statistics-header { align-items: flex-start; flex-direction: column; gap: 20px; margin-bottom: 22px; }h1 { font-size: 34px; }.period-controls { width: 100%; }.period-tabs button { flex: 1; }.date-range { justify-content: flex-start; margin-top: 12px; font-size: 12px; }.statistics-kpis { grid-template-columns: 1fr 1fr; row-gap: 24px; }.statistics-kpis article { padding: 0 12px; }.statistics-kpis article:nth-child(3) { padding-left: 0; border-left: 0; }.statistics-kpis h2 { font-size: 12px; }.statistics-kpis strong { font-size: 34px; }.statistics-kpis .focus-total { font-size: 27px; }.statistics-kpis p { font-size: 10px; }h2 { font-size: 16px; }.block-heading > span { font-size: 10px; white-space: nowrap; }.chart { height: 160px; margin-top: 48px; }.chart-bars { gap: 10px; padding: 0 5px; }.bar-value { font-size: 8px; }.life-distribution-row { grid-template-columns: 22px 70px minmax(20px,1fr) 22px 32px; gap: 8px; font-size: 12px; }.exhausted-summary > div { min-width: 180px; }.primary-button { min-height: 40px; }.completed-statistics table,.completed-statistics tbody { display: block; }.completed-statistics thead { display: none; }.completed-statistics tr { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px 0; border-top: 1px solid var(--stats-line); }.completed-statistics td { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; border: 0; padding: 0; font-size: 12px; }.completed-statistics .completed-title { grid-column: 1 / -1; min-height: 20px; justify-content: center; }.completed-title svg { top: 0; }.completed-statistics td::before { content: attr(data-label); color: var(--stats-muted); font-size: 10px; }.completed-statistics .completed-title::before { display: none; }.completion-life { gap: 6px; flex-wrap: wrap; }.completion-hearts { font-size: 12px; }.statistics-error { align-items: flex-start; flex-direction: column; } }
</style>
