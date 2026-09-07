<script setup lang="ts">
import { computed } from 'vue'
import { Play, Pause, ListTree } from '@lucide/vue'
import { useTaskFocus } from '@/app/task-focus-context'
import type { TaskItem } from '@/lib/app-state'
import { durationLabel, FOCUS_BUDGET_MS, lifeRemainingMs, livesLeft } from '@/lib/task-focus'
const props = defineProps<{ task: TaskItem; disabled?: boolean }>()
const board = useTaskFocus()
const spent = computed(() => board?.getTaskFocusMs(props.task) ?? props.task.focusSpentMs ?? 0)
const lives = computed(() => livesLeft(spent.value))
const running = computed(() => board?.activeTimerTaskId.value === props.task.id && !props.task.completed && !props.task.deletedAt && !props.task.isContainer && spent.value < FOCUS_BUDGET_MS)
const canSplit = computed(() => !props.task.completed && !props.task.deletedAt && !props.task.isContainer && props.task.focusSpentMs >= FOCUS_BUDGET_MS)
async function toggleTimer() {
  if (!board) return
  try {
    if (running.value) await board.pauseTimer(props.task.id)
    else await board.startTimer(props.task.id)
  } catch (error) {
    board.focusMessage.value = error instanceof Error ? error.message : 'Не удалось запустить таймер'
  }
}
</script>
<template>
  <span class="task-lives" @click.stop @dblclick.stop @mousedown.stop @dragstart.stop.prevent>
    <span v-if="!task.isContainer" class="inline-clock">
      <button v-if="!task.completed && !task.deletedAt" type="button" class="clock-button" :disabled="disabled || spent >= FOCUS_BUDGET_MS" :aria-label="`${running ? 'Пауза' : 'Начать'}: ${task.title}`" :title="running ? 'Пауза' : 'Начать'" @click="toggleTimer"><Pause v-if="running" aria-hidden="true" /><Play v-else aria-hidden="true" /></button>
      <span class="countdown" :aria-label="`До конца текущей жизни: ${durationLabel(lifeRemainingMs(spent))}`">{{ durationLabel(lifeRemainingMs(spent)) }}</span>
    </span>
    <span class="hearts" role="img" :aria-label="`Осталось ${lives} жизни из 3${running && lives ? '. Активная жизнь ' + (4 - lives) : ''}`">
      <span v-for="index in 3" :key="index" aria-hidden="true" class="heart" :title="`${index}-я жизнь: ${[15, 30, 45][index - 1]} минут`" :class="{ empty: index < 4 - lives, active: running && index === 4 - lives }">{{ index < 4 - lives ? '🖤' : running && index === 4 - lives ? '💚' : '❤️' }}</span>
    </span>
    <button v-if="canSplit" type="button" class="split-button" :disabled="disabled" :aria-label="`Разбить на подзадачи: ${task.title}`" @click="board && (board.splitTaskId.value = task.id)"><ListTree aria-hidden="true" /><span>Подзадачи</span></button>
  </span>
</template>
<style scoped>
.task-lives { display:inline-flex; align-items:center; gap:7px; flex:0 0 auto; color:#515d70; line-height:1.2; }
.inline-clock { display:inline-flex; align-items:center; gap:3px; }
.clock-button,.split-button { display:inline-flex; justify-content:center; align-items:center; width:24px; height:26px; padding:3px; border:0; border-radius:5px; color:#536580; background:transparent; cursor:pointer; }
.clock-button svg { width:14px; height:14px; }.split-button { width:auto; gap:4px; font-size:11px; }.split-button svg { width:13px; height:13px; }
.clock-button:hover,.split-button:hover { background:#e1e7f0; }.clock-button:disabled { opacity:.4; cursor:default; }
.clock-button:focus-visible,.split-button:focus-visible { outline:2px solid #5369bc; outline-offset:2px; }
.countdown { min-width:34px; font:500 11px/1.2 Inter,sans-serif; font-variant-numeric:tabular-nums; text-align:center; }
.hearts { display:inline-flex; align-items:center; gap:2px; color:#b7495e; font-size:16px; white-space:nowrap; }
.heart { display:inline-block; font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif; }
@media(max-width:640px) { .task-lives { gap:3px; }.clock-button { width:20px; }.countdown { min-width:31px; font-size:10px; }.hearts { gap:0; font-size:14px; } }
</style>
