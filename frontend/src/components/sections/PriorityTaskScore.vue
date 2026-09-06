<script setup lang="ts">
import { ref } from 'vue'

import type { TaskItem } from '@/lib/app-state'

const props = defineProps<{
  task: TaskItem
  adjustScore: (
    taskId: string,
    field: 'importance' | 'urgency' | 'overdue',
    delta: -1 | 1,
  ) => Promise<void>
}>()

const busy = ref(false)

async function adjust(field: 'importance' | 'urgency' | 'overdue', delta: -1 | 1) {
  if (busy.value) return
  busy.value = true
  try {
    await props.adjustScore(props.task.id, field, delta)
  } catch {
    // Глобальный статус уже показывает ошибку API.
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="task-score" @mousedown.stop @dragstart.stop.prevent>
    <div class="score-control">
      <div class="score-stepper" role="group" aria-label="Важность">
        <button
          type="button"
          :disabled="busy || task.priorityImportance <= 0"
          :aria-label="`Уменьшить важность: ${task.title}`"
          @click.stop="adjust('importance', -1)"
        >
          −
        </button>
        <strong>{{ task.priorityImportance }}</strong>
        <button
          type="button"
          :disabled="busy || task.priorityImportance >= 9"
          :aria-label="`Увеличить важность: ${task.title}`"
          @click.stop="adjust('importance', 1)"
        >
          +
        </button>
      </div>
    </div>

    <div class="score-control">
      <div class="score-stepper" role="group" aria-label="Срочность">
        <button
          type="button"
          :disabled="busy || task.priorityUrgency <= 0"
          :aria-label="`Уменьшить срочность: ${task.title}`"
          @click.stop="adjust('urgency', -1)"
        >
          −
        </button>
        <strong>{{ task.priorityUrgency }}</strong>
        <button
          type="button"
          :disabled="busy || task.priorityUrgency >= 9"
          :aria-label="`Увеличить срочность: ${task.title}`"
          @click.stop="adjust('urgency', 1)"
        >
          +
        </button>
      </div>
    </div>

    <div class="score-control">
      <div class="score-stepper" role="group" aria-label="Просрочка">
        <button
          type="button"
          :disabled="busy || task.priorityOverdue <= 0"
          :aria-label="`Уменьшить просрочку: ${task.title}`"
          @click.stop="adjust('overdue', -1)"
        >
          −
        </button>
        <strong>{{ task.priorityOverdue }}</strong>
        <button
          type="button"
          :disabled="busy || task.priorityOverdue >= 9"
          :aria-label="`Увеличить просрочку: ${task.title}`"
          @click.stop="adjust('overdue', 1)"
        >
          +
        </button>
      </div>
    </div>

    <span
      class="task-weight"
      :aria-label="`Вес задачи: ${task.priorityImportance + task.priorityUrgency + task.priorityOverdue}`"
    >
      Вес {{ task.priorityImportance + task.priorityUrgency + task.priorityOverdue }}
    </span>
  </div>
</template>

<style scoped>
.task-score {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
}

.task-weight {
  min-width: 50px;
  border-radius: 999px;
  background: #dfe7f3;
  color: #344c70;
  padding: 4px 7px;
  text-align: center;
  font-size: 10px;
  line-height: 1;
  font-weight: 800;
  white-space: nowrap;
}

.score-control {
  display: inline-flex;
  align-items: center;
}

.score-stepper {
  height: 26px;
  border: 1px solid #d8dee8;
  border-radius: 7px;
  background: #fff;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
}

.score-stepper button {
  width: 24px;
  height: 24px;
  border: 0;
  background: #f3f5f8;
  color: #41516a;
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  line-height: 1;
}

.score-stepper button:hover:not(:disabled) {
  background: #e5eaf1;
}

.score-stepper button:disabled {
  color: #b8c0cc;
  cursor: default;
}

.score-stepper strong {
  width: 22px;
  color: #303844;
  text-align: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.score-stepper button:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid #8fb1ff;
  outline-offset: -2px;
}

@media (max-width: 760px) {
  .task-score {
    width: 100%;
    gap: 4px;
  }

  .task-weight {
    margin-left: auto;
  }

  .score-stepper button {
    width: 20px;
  }

  .score-stepper strong {
    width: 18px;
  }
}
</style>
