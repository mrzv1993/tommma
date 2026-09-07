<script setup lang="ts">
import { computed, ref } from 'vue'
import { Play, Pause, ChevronDown } from '@lucide/vue'
import { useTaskFocus } from '@/app/task-focus-context'
import type { TaskItem } from '@/lib/app-state'
import { durationLabel, FOCUS_BUDGET_MS, FOCUS_LEASE_MS, lifeRemainingMs, livesLeft } from '@/lib/task-focus'
const props = defineProps<{ task: TaskItem; anchorTaskId?: string }>()
const board = useTaskFocus()
const busy = ref(false)
const spent = computed(() => board?.getTaskFocusMs(props.task) ?? props.task.focusSpentMs ?? 0)
const lives = computed(() => livesLeft(spent.value))
const running = computed(() => props.task.focusHeartbeatAt && (board?.focusNow.value ?? Date.now()) - Date.parse(props.task.focusHeartbeatAt) <= FOCUS_LEASE_MS && spent.value < FOCUS_BUDGET_MS)
const children = computed(() => board?.state.value.tasks.filter(t => t.parentTaskId === props.task.id) ?? [])
const label = computed(() => props.task.isContainer
  ? `${children.value.filter(t => t.completed).length} из ${children.value.length} завершены`
  : !props.task.completed && spent.value >= FOCUS_BUDGET_MS ? 'Нужно разбить' : '')
const expanded = computed(() => board?.focusTaskId.value === props.task.id)
function details() {
  if (!board) return
  board.focusAnchorTaskId.value = props.anchorTaskId ?? props.task.id
  board.focusTaskId.value = expanded.value ? null : props.task.id
}
async function toggleTimer() {
  if (!board || busy.value) return
  if (!props.task.doneWhen.trim()) {
    board.focusAnchorTaskId.value = props.anchorTaskId ?? props.task.id
    board.focusTaskId.value = props.task.id
    return
  }
  busy.value = true
  try {
    if (running.value) await board.pauseTimer(props.task.id)
    else await board.startTimer(props.task.id)
  } catch (error) {
    board.focusMessage.value = error instanceof Error ? error.message : 'Не удалось запустить таймер'
  } finally { busy.value = false }
}
</script>
<template>
  <span class="task-lives" @click.stop @dblclick.stop @mousedown.stop @dragstart.stop.prevent>
    <span v-if="!task.isContainer" class="inline-clock">
      <button v-if="!task.completed && !task.deletedAt" type="button" class="clock-button" :disabled="busy || spent >= FOCUS_BUDGET_MS" :aria-label="`${running ? 'Пауза' : 'Начать'}: ${task.title}`" :title="running ? 'Пауза' : task.doneWhen ? 'Начать' : 'Сначала укажи результат'" @click="toggleTimer"><Pause v-if="running" aria-hidden="true" /><Play v-else aria-hidden="true" /></button>
      <span class="countdown" :aria-label="`До конца текущей жизни: ${durationLabel(lifeRemainingMs(spent))}`">{{ durationLabel(lifeRemainingMs(spent)) }}</span>
    </span>
    <span class="hearts" role="img" :aria-label="`Осталось ${lives} жизни из 3${!task.completed && lives ? '. Текущая жизнь ' + (4 - lives) : ''}`">
      <span v-for="index in 3" :key="index" aria-hidden="true" class="heart" :class="{ empty: index > lives, active: index === lives && !task.completed && !task.isContainer && !task.deletedAt }">{{ index <= lives ? '♥' : '♡' }}</span>
    </span>
    <span v-if="label" class="life-state">{{ label }}</span>
    <button type="button" class="details-button" :aria-expanded="expanded" :aria-label="`${expanded ? 'Свернуть' : 'Показать'} детали: ${task.title}`" title="Условие завершения и подзадачи" @click="details"><ChevronDown aria-hidden="true" :class="{ expanded }" /></button>
  </span>
</template>
<style scoped>
.task-lives { display:inline-flex; align-items:center; gap:7px; flex:0 0 auto; color:#515d70; line-height:1.2; }
.inline-clock { display:inline-flex; align-items:center; gap:3px; }
.clock-button,.details-button { display:inline-flex; justify-content:center; align-items:center; width:24px; height:26px; padding:3px; border:0; border-radius:5px; color:#536580; background:transparent; cursor:pointer; }
.clock-button svg { width:14px; height:14px; }.details-button svg { width:13px; height:13px; }.expanded { transform:rotate(180deg); }
.clock-button:hover,.details-button:hover { background:#e1e7f0; }.clock-button:disabled { opacity:.4; cursor:default; }
.clock-button:focus-visible,.details-button:focus-visible { outline:2px solid #5369bc; outline-offset:2px; }
.countdown { min-width:34px; font:500 11px/1.2 Inter,sans-serif; font-variant-numeric:tabular-nums; text-align:center; }
.hearts { display:inline-flex; align-items:center; gap:2px; color:#b7495e; font-size:16px; white-space:nowrap; }
.heart { border-bottom:2px solid transparent; }.heart.active { color:#13776d; border-bottom-color:currentColor; }.heart.empty { color:#707b8b; }
.life-state { max-width:95px; font-size:10px; }
@media(max-width:640px) { .task-lives { gap:3px; }.clock-button,.details-button { width:20px; }.countdown { min-width:31px; font-size:10px; }.hearts { gap:0; font-size:14px; }.life-state { max-width:65px; } }
</style>
