<script setup lang="ts">
import { computed } from 'vue'
import type { PriorityListItem } from '@/lib/goals'

const props = defineProps<{
  goal: PriorityListItem
  disabled?: boolean
  adjustPriority: (goalId: string, delta: -1 | 1) => Promise<void>
}>()
const priority = computed(() => props.goal.priorityImportance + props.goal.priorityUrgency + props.goal.priorityOverdue)

function adjust(delta: -1 | 1) {
  if (props.disabled) return
  void props.adjustPriority(props.goal.id, delta).catch(() => {
    // The goal list shows the save error and retry action.
  })
}
</script>

<template>
  <div class="goal-priority" @mousedown.stop @dragstart.stop.prevent>
    <span class="goal-priority-label">Приоритет</span>
    <div class="goal-priority-stepper" role="group" :aria-label="`Приоритет цели: ${goal.title}`">
      <button type="button" :disabled="disabled || priority <= 0" :aria-label="`Уменьшить приоритет: ${goal.title}`" @click.stop="adjust(-1)">−</button>
      <strong :aria-label="`Приоритет цели: ${priority}`">{{ priority }}</strong>
      <button type="button" :disabled="disabled" :aria-label="`Увеличить приоритет: ${goal.title}`" @click.stop="adjust(1)">+</button>
    </div>
  </div>
</template>

<style scoped>
.goal-priority { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; cursor: default; }
.goal-priority-label { color: #6e7a8d; font-size: 10px; font-weight: 700; }
.goal-priority-stepper { height: 26px; border: 1px solid #d8dee8; border-radius: 7px; background: #fff; display: inline-flex; align-items: center; overflow: hidden; }
.goal-priority-stepper button { width: 24px; height: 24px; border: 0; background: #f3f5f8; color: #41516a; padding: 0; cursor: pointer; font: inherit; font-size: 14px; line-height: 1; }
.goal-priority-stepper button:hover:not(:disabled) { background: #e5eaf1; }
.goal-priority-stepper button:disabled { color: #b8c0cc; cursor: default; }
.goal-priority-stepper strong { min-width: 22px; padding: 0 4px; color: #303844; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; }
.goal-priority-stepper button:focus-visible { position: relative; z-index: 1; outline: 2px solid #8fb1ff; outline-offset: -2px; }
@media (max-width: 760px) {
  .goal-priority { width: 100%; justify-content: flex-end; gap: 6px; }
}
</style>
