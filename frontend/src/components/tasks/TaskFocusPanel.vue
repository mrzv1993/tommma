<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTaskFocus } from '@/app/task-focus-context'
import TaskLifeBadge from './TaskLifeBadge.vue'
import { durationLabel, FOCUS_BUDGET_MS, FOCUS_LEASE_MS, lifeRemainingMs, livesLeft } from '@/lib/task-focus'
defineProps<{ anchorTaskId: string }>()
const board = useTaskFocus()!
const task = computed(() => board ? [...board.state.value.tasks, ...board.trashedTasks.value].find(t => t.id === board.focusTaskId.value) : undefined)
const children = computed(() => [...board.state.value.tasks, ...board.trashedTasks.value].filter(t => t.parentTaskId === task.value?.id))
const required = computed(() => children.value.filter(t => !t.deletedAt))
const ready = computed(() => required.value.every(t => t.completed))
const spent = computed(() => task.value ? board.getTaskFocusMs(task.value) : 0)
const exhausted = computed(() => spent.value >= FOCUS_BUDGET_MS)
const running = computed(() => task.value?.focusHeartbeatAt && board.focusNow.value - Date.parse(task.value.focusHeartbeatAt) <= FOCUS_LEASE_MS && !exhausted.value)
const busy = ref(false)
const error = ref('')
const doneWhen = ref('')
const summary = ref('')
const splitting = ref(false)
const confirmResult = ref(false)
const drafts = ref<{ id: string; title: string; doneWhen: string }[]>([])
const minimum = computed(() => exhausted.value && !task.value?.isContainer ? 2 : 1)
watch(() => task.value?.id, () => {
  doneWhen.value = task.value?.doneWhen ?? ''
  summary.value = task.value?.workSummary ?? ''
  splitting.value = false
  confirmResult.value = false
  error.value = ''
})
async function perform(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : 'Не удалось сохранить. Попробуй снова.' }
  finally { busy.value = false }
}
function addDraft() { drafts.value.push({ id: crypto.randomUUID(), title: '', doneWhen: '' }) }
function openSplit() {
  splitting.value = true
  drafts.value = []
  for (let i = 0; i < minimum.value; i++) addDraft()
}
async function saveCondition() {
  if (task.value && doneWhen.value.trim() !== task.value.doneWhen) await board.saveDoneWhen(task.value.id, doneWhen.value.trim())
}
async function start() { await saveCondition(); if (task.value) await board.startTimer(task.value.id) }
async function finish() { await saveCondition(); if (task.value) await board.finishTask(task.value.id, confirmResult.value) }
async function split() {
  if (!task.value) return
  await board.splitTask(task.value.id, doneWhen.value.trim(), summary.value.trim(), drafts.value)
  splitting.value = false
}
</script>
<template>
  <section v-if="task && (board.focusAnchorTaskId.value || task.id) === anchorTaskId" class="focus-panel" :aria-label="`Карточка задачи: ${task.title}`" :aria-busy="busy" @click.stop @dblclick.stop @mousedown.stop @dragstart.stop.prevent>
        <header class="focus-header">
          <div>
            <button v-if="task.parentTaskId" type="button" class="text-button" :disabled="busy" @click="board.focusTaskId.value = task.parentTaskId">← К родительской задаче</button>
            <h3 class="focus-title">{{ task.title }}</h3>
            <p class="focus-description">{{ task.deletedAt ? 'Отменена · время сохранено' : task.completed ? 'Завершено' : task.isContainer ? 'Родительская задача' : exhausted ? 'Нужно разбить' : 'Три жизни · 15, 30 и 45 минут' }}</p>
          </div>
          <button type="button" class="close-button" aria-label="Свернуть карточку" @click="board.focusTaskId.value = null; board.focusAnchorTaskId.value = null">×</button>
        </header>
        <div class="focus-hearts" :aria-label="`Осталось ${livesLeft(spent)} жизни из 3`"><span v-for="index in 3" :key="index" aria-hidden="true" :class="{ empty: index > livesLeft(spent), 'active-heart': index === livesLeft(spent) && !task.completed && !task.isContainer }">{{ index <= livesLeft(spent) ? '♥' : '♡' }}</span></div>
        <div class="focus-time">
          <div v-if="!task.isContainer && !task.completed && !task.deletedAt"><strong>{{ durationLabel(lifeRemainingMs(spent)) }}</strong><span>до конца {{ livesLeft(spent) === 3 ? 'первой' : livesLeft(spent) === 2 ? 'второй' : 'последней' }} жизни{{ running ? ' · идёт работа' : ' · пауза' }}</span></div>
          <dl><div><dt>Своё время</dt><dd>{{ durationLabel(board.getTaskElapsedSeconds(task, board.focusNow.value) * 1000) }}</dd></div><div><dt>Всего с подзадачами</dt><dd>{{ durationLabel(board.getTaskTotalMs(task.id)) }}</dd></div></dl>
        </div>
        <form class="condition-form" @submit.prevent="perform(saveCondition)">
          <label for="task-done-when">Готово, когда…</label>
          <textarea id="task-done-when" v-model="doneWhen" maxlength="500" rows="2" :disabled="busy || task.completed || Boolean(task.deletedAt)" placeholder="Опиши короткий проверяемый результат" />
          <div class="condition-footer"><small>Обязательно перед первым запуском таймера.</small><button v-if="doneWhen.trim() !== task.doneWhen" type="submit" :disabled="busy || !doneWhen.trim()">Сохранить</button></div>
        </form>
        <p v-if="error" class="focus-error" role="alert">{{ error }}</p>
        <div v-if="!task.completed && !task.deletedAt" class="focus-actions">
          <template v-if="!task.isContainer && !exhausted">
            <button v-if="running" type="button" :disabled="busy" @click="perform(() => board.pauseTimer(task!.id))">Пауза</button>
            <button v-else type="button" class="primary" :disabled="busy || !doneWhen.trim()" @click="perform(start)">{{ busy ? 'Сохраняю…' : 'Начать' }}</button>
          </template>
          <button v-if="!task.isContainer" type="button" :disabled="busy" @click="perform(finish)">Завершить</button>
          <button type="button" :disabled="busy" @click="openSplit">{{ task.isContainer ? 'Добавить подзадачи' : 'Разбить на подзадачи' }}</button>
        </div>
        <p v-if="exhausted && !task.isContainer && !task.completed" class="budget-message"><strong>Бюджет задачи исчерпан.</strong> Зафиксируй, что уже сделано, и разбей оставшуюся работу на конкретные результаты.</p>
        <section v-if="splitting" class="split-form">
          <form @submit.prevent="perform(split)">
            <h3>{{ task.isContainer ? 'Новые подзадачи' : 'Разбить на подзадачи' }}</h3>
            <label for="work-summary">Что уже сделано <small>· необязательно</small></label>
            <textarea id="work-summary" v-model="summary" rows="2" maxlength="4000" :disabled="busy" />
            <p v-if="minimum === 2">Нужны минимум две подзадачи с конкретными результатами.</p>
            <fieldset v-for="(draft, index) in drafts" :key="draft.id" :disabled="busy">
              <legend>Подзадача {{ index + 1 }}</legend>
              <label :for="`child-title-${draft.id}`">Название</label>
              <input :id="`child-title-${draft.id}`" v-model="draft.title" required maxlength="255" />
              <label :for="`child-done-${draft.id}`">Готово, когда…</label>
              <textarea :id="`child-done-${draft.id}`" v-model="draft.doneWhen" required maxlength="500" rows="2" />
              <button v-if="drafts.length > minimum" type="button" class="text-button" @click="drafts.splice(index, 1)">Убрать</button>
            </fieldset>
            <div class="focus-actions"><button type="button" :disabled="busy || drafts.length >= 50" @click="addDraft">+ Подзадача</button><button class="primary" type="submit" :disabled="busy || !doneWhen.trim() || drafts.some(d => !d.title.trim() || !d.doneWhen.trim())">Создать подзадачи</button><button type="button" :disabled="busy" @click="splitting = false">Отмена</button></div>
          </form>
        </section>
        <section v-if="task.isContainer" class="children-section">
          <h3>{{ required.filter(t => t.completed).length }} из {{ required.length }} завершены</h3>
          <p v-if="task.workSummary" class="work-summary"><strong>Что уже сделано:</strong> {{ task.workSummary }}</p>
          <ul class="child-list"><li v-for="child in children" :key="child.id"><button type="button" class="child-name" :disabled="busy" @click="board.focusTaskId.value = child.id"><strong>{{ child.title }}</strong><span>{{ child.deletedAt ? 'Отменена · время сохранено' : child.completed ? 'Завершено' : child.isContainer ? 'Родительская задача' : child.focusSpentMs >= FOCUS_BUDGET_MS ? 'Нужно разбить' : 'В работе' }} · {{ durationLabel(board.getTaskTotalMs(child.id)) }}</span></button><TaskLifeBadge :task="child" :anchor-task-id="anchorTaskId" /></li></ul>
          <div v-if="!task.completed && !task.deletedAt" class="parent-finish"><p v-if="!ready">Заверши или отмени все обязательные подзадачи, чтобы подтвердить исходный результат.</p><label v-else><input v-model="confirmResult" type="checkbox" :disabled="busy" /> Подтверждаю: исходное условие «Готово, когда…» достигнуто</label><button type="button" class="primary" :disabled="busy || !ready || !confirmResult || !doneWhen.trim()" @click="perform(finish)">Завершить задачу</button></div>
        </section>
        <details v-if="task.subtasks.length"><summary>Сохранённый чек-лист ({{ task.subtasks.length }})</summary><ul><li v-for="item in task.subtasks" :key="item.id">{{ item.completed ? '✓' : '○' }} {{ item.title }}</li></ul></details>
        <div v-if="task.completed || task.deletedAt" class="focus-actions"><button type="button" :disabled="busy" @click="perform(() => task!.deletedAt ? board.restoreDeletedTaskFromServer(task!.id) : board.restorePriorityTask(task!.id))">{{ task.deletedAt ? 'Восстановить' : 'Открыть повторно' }}</button></div>
        <button v-else-if="task.parentTaskId" type="button" class="text-button cancel-child" :disabled="busy" @click="perform(() => board.removeTask(task!.id))">Отменить подзадачу · сохранить время</button>
  </section>
</template>
<style scoped>
.focus-panel { flex:0 0 100%; min-width:0; width:100%; padding:20px; margin:8px 0 0; border:1px solid #dde2e9; border-radius:10px; background:#fff; color:#273142; font:14px/1.5 Inter, sans-serif; }
.focus-header { display:flex; justify-content:space-between; gap:16px; }
.focus-title { font-size:21px; font-weight:700; overflow-wrap:anywhere; margin:0; }
.focus-description { color:#6b7584; margin:4px 0 0; }
.focus-panel button { cursor:pointer; border:1px solid #dce2eb; border-radius:8px; padding:8px 12px; background:#f7f8fa; font-size:13px; }
.focus-panel button.primary { background:#354971; border-color:#354971; color:white; }
.focus-panel button:disabled { opacity:.5; cursor:default; }
.focus-panel button:focus-visible,.focus-panel input:focus-visible,.focus-panel textarea:focus-visible { outline:2px solid #5369bc; outline-offset:2px; }
.focus-panel .close-button { align-self:flex-start; font-size:21px; line-height:1; background:transparent; }
.focus-hearts { font-size:32px; letter-spacing:4px; color:#b7495e; margin:14px 0 0; }
.empty { color:#7c8694; }.active-heart { color:#13776d; text-decoration:underline; text-underline-offset:5px; }
.focus-time { display:flex; align-items:center; justify-content:space-between; gap:20px; margin:8px 0 20px; font-variant-numeric:tabular-nums; }
.focus-time strong { display:block; font-size:34px; line-height:1.2; }
.focus-time span { font-size:12px; color:#6b7584; }
.focus-time dl { margin:0; font-size:12px; }
.focus-time dl div { display:flex; justify-content:space-between; gap:18px; }
.focus-time dd { margin:0; font-weight:600; }
.condition-form label,.split-form label { display:block; font-weight:600; margin:10px 0 5px; }
.focus-panel textarea,.split-form input { display:block; width:100%; background:#fff; border:1px solid #cbd3df; border-radius:8px; padding:9px; font:inherit; resize:vertical; }
.condition-footer { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:6px; color:#6b7584; }
.focus-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
.budget-message { padding:12px; background:#fbf0e4; border-radius:8px; }
.focus-error { padding:10px; background:#fff0f1; color:#943344; border-radius:8px; }
.split-form { margin-top:20px; border-top:1px solid #e0e5ec; }
.split-form fieldset { padding:12px; margin:16px 0; border:1px solid #dce2eb; border-radius:8px; }
.focus-panel h3 { font-size:15px; font-weight:700; margin:18px 0 10px; }
.focus-panel .text-button { background:transparent; border:0; padding:4px 0; color:#526382; }
.child-list { list-style:none; margin:12px 0; padding:0; }
.child-list li { display:flex; align-items:center; justify-content:space-between; gap:8px; border-bottom:1px solid #e6eaf0; padding:8px 0; }
.focus-panel .child-name { text-align:left; border:0; background:transparent; padding:4px 0; min-width:0; overflow-wrap:anywhere; }
.child-name strong,.child-name span { display:block; }.child-name span { color:#6b7584; font-size:12px; }
.work-summary { white-space:pre-wrap; overflow-wrap:anywhere; }.parent-finish { display:grid; gap:12px; padding-top:8px; }.parent-finish label { display:flex; align-items:flex-start; gap:8px; }.parent-finish input { margin-top:5px; }.cancel-child { margin-top:18px; }
details { margin-top:16px; color:#6b7584; }
@media(max-width:480px) { .focus-panel { padding:18px; }.focus-time { align-items:flex-start; flex-direction:column; gap:10px; }.focus-time dl { width:100%; } }
</style>
