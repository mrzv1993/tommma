<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, CheckCircle2 } from '@lucide/vue'
import type { GoalItem } from '@/lib/goals'

const props = defineProps<{ goals: GoalItem[]; loading: boolean; error: string }>()
const emit = defineEmits<{ back: []; retry: [] }>()
const period = ref<7 | 30 | 90>(7)
const visibleCount = ref(10)
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const days = computed(() => Array.from({ length: period.value }, (_, index) => {
  const date = new Date(); date.setDate(date.getDate() - period.value + index + 1)
  return dateKey(date)
}))
const active = computed(() => props.goals.filter(goal => !goal.deletedAt && !goal.completed))
const completed = computed(() => props.goals.filter(goal => !goal.deletedAt && goal.completed && goal.completedAt && days.value.includes(dateKey(new Date(goal.completedAt))))
  .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!)))
const buckets = computed(() => {
  const step = period.value === 7 ? 1 : 7
  return Array.from({ length: Math.ceil(days.value.length / step) }, (_, index) => {
    const dates = days.value.slice(index * step, (index + 1) * step)
    return { start: dates[0]!, end: dates.at(-1)!, count: completed.value.filter(goal => dates.includes(dateKey(new Date(goal.completedAt!)))).length }
  })
})
const maxCount = computed(() => Math.max(1, ...buckets.value.map(bucket => bucket.count)))
const label = (date: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(date.length === 10 ? `${date}T12:00:00` : date))
</script>

<template>
  <section class="goal-statistics" aria-label="Статистика целей" :aria-busy="loading">
    <header>
      <div><button class="back-link" type="button" @click="emit('back')"><ArrowLeft aria-hidden="true" />К целям</button><h1>Статистика целей</h1></div>
      <div class="period-tabs" role="group" aria-label="Период статистики"><button v-for="value in ([7, 30, 90] as const)" :key="value" type="button" :aria-pressed="period === value" @click="period = value; visibleCount = 10">{{ value }} дней</button></div>
    </header>
    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" :disabled="loading" @click="emit('retry')">Повторить</button></p>
    <div class="metrics">
      <article><h2>Завершено целей</h2><strong>{{ completed.length }}</strong><p>{{ label(days[0]!) }} — {{ label(days.at(-1)!) }}</p></article>
      <article><h2>Активных целей</h2><strong>{{ active.length }}</strong><p>Сейчас</p></article>
      <article><h2>В приоритетах</h2><strong>{{ active.filter(goal => goal.priorityGroup !== null).length }}</strong><p>Из 45 мест</p></article>
      <article><h2>Во Входящих</h2><strong>{{ active.filter(goal => goal.priorityGroup === null).length }}</strong><p>Ожидают распределения</p></article>
    </div>
    <article class="chart-section"><h2>{{ period === 7 ? 'Завершённые цели по дням' : 'Завершённые цели по неделям' }}</h2>
      <div class="chart" role="img" :aria-label="buckets.map(bucket => `${label(bucket.start)} — ${label(bucket.end)}: ${bucket.count}`).join('; ')">
        <div v-for="bucket in buckets" :key="bucket.start" class="chart-column"><strong>{{ bucket.count }}</strong><div class="bar-track"><span :style="{ height: `${bucket.count / maxCount * 100}%` }" /></div><small>{{ label(bucket.start) }}</small></div>
      </div>
    </article>
    <article class="completed"><h2>Последние завершённые цели</h2>
      <p v-if="!completed.length" class="empty">За выбранный период завершённых целей пока нет.</p>
      <ul v-else><li v-for="goal in completed.slice(0, visibleCount)" :key="goal.id"><CheckCircle2 aria-hidden="true" /><span>{{ goal.title }}</span><time :datetime="goal.completedAt!">{{ label(goal.completedAt!) }}</time></li></ul>
      <button v-if="completed.length > visibleCount" type="button" @click="visibleCount += 10">Показать ещё</button>
    </article>
  </section>
</template>

<style scoped>
.goal-statistics { flex: 1; min-width: 0; overflow-y: auto; padding: 28px 28px 36px 100px; color: #243650; font-family: Inter, sans-serif; }
header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 28px; }
h1,h2,p { margin: 0; } h1 { font-size: 28px; letter-spacing: -.02em; } h2 { font-size: 15px; }
button { border: 1px solid #d8e1ef; border-radius: 7px; padding: 8px 12px; background: #fff; color: #2455be; font: 600 12px Inter,sans-serif; cursor: pointer; } button:focus-visible { outline: 2px solid #2455be; outline-offset: 2px; }
.back-link { display: inline-flex; gap: 6px; align-items: center; border: 0; padding: 0; background: transparent; margin-bottom: 12px; } svg { width: 16px; height: 16px; }
.period-tabs { display: flex; gap: 4px; }.period-tabs [aria-pressed="true"] { background: #1f3d6e; color: white; border-color: #1f3d6e; }
.metrics { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }.metrics article { background: #fff; padding: 20px; border: 1px solid #dbe3ee; border-radius: 10px; }.metrics h2 { font-size: 12px; color: #687489; }.metrics strong { display: block; font-size: 34px; margin: 10px 0; }.metrics p { font-size: 11px; color: #687489; }
.chart-section,.completed { margin-top: 24px; padding: 24px; border: 1px solid #dbe3ee; border-radius: 12px; background: #fff; }.chart { display: flex; gap: 12px; margin-top: 24px; }.chart-column { flex: 1; min-width: 0; text-align: center; font-size: 12px; }.bar-track { height: 140px; display: flex; align-items: flex-end; margin: 8px 0; border-bottom: 1px solid #dbe3ee; }.bar-track span { display: block; width: 100%; min-height: 2px; background: #5c82c0; border-radius: 3px 3px 0 0; }.chart small { font-size: 10px; color: #687489; }
ul { list-style: none; padding: 0; margin: 12px 0 0; }li { display: flex; gap: 12px; align-items: center; padding: 14px 0; border-top: 1px solid #e6ebf2; font-size: 13px; }li span { flex: 1; overflow-wrap: anywhere; }li svg { flex-shrink: 0; }time { font-size: 12px; color: #687489; white-space: nowrap; }.empty { padding-top: 24px; color: #687489; font-size: 13px; }.error { padding: 14px; margin-bottom: 16px; background: #fff7f7; color: #8c3434; border-radius: 8px; }
@media(max-width:760px) { .goal-statistics { padding: 70px 16px 24px; }header { align-items: flex-start; flex-direction: column; gap: 16px; }.metrics { grid-template-columns: 1fr 1fr; }.metrics article { padding: 14px; }.chart-section,.completed { padding: 16px; }.chart { gap: 5px; }.chart small { font-size: 8px; }.bar-track { height: 110px; } }
</style>
