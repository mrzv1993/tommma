<script setup lang="ts">
import { Check, CircleX, Plus } from '@lucide/vue'

import { useCalendarBoardContext } from '@/app/calendar-board-context'
import CalendarFinancePanel from '@/components/board/CalendarFinancePanel.vue'

type CalendarDay = {
  dateKey: string
  title: string
  fullTitle: string
  isToday: boolean
}

defineProps<{
  day: CalendarDay
}>()

const calendar = useCalendarBoardContext()
</script>

<template>
  <article :data-date-key="day.dateKey" class="day-col" :class="{ today: day.isToday }">
    <header class="day-head">
      <h3 :title="day.fullTitle">{{ day.title }}</h3>
      <div class="day-progress">
        <span>{{ calendar.dayPercent(day.dateKey) }}%</span>
        <span class="progress-ring" :class="{ complete: calendar.dayPercent(day.dateKey) === 100 }" />
      </div>
    </header>

    <div class="day-split">
      <section class="day-top">
        <ul class="day-list">
          <li
            v-for="task in calendar.tasksByDay.get(day.dateKey) || []"
            :key="task.id"
            class="task-row"
            @click.stop="calendar.handleTaskRowClick(task.id)"
            @dblclick.stop.prevent="calendar.startTaskTitleEdit(task)"
          >
            <span class="check" :class="{ done: task.completed }">
              <Check v-if="task.completed" class="check-icon" />
            </span>
            <input
              v-if="calendar.isTaskTitleEditing(task.id)"
              v-model="calendar.editingTaskTitles[task.id]"
              class="task-name task-name-edit"
              :data-task-edit="task.id"
              @click.stop
              @keydown.enter.prevent="calendar.handleTaskTitleEnter(task.id, $event)"
              @keydown.esc.prevent="calendar.handleTaskTitleEscape(task.id, $event)"
              @blur="calendar.handleTaskTitleBlur(task.id)"
            />
            <span v-else class="task-name" :class="{ done: task.completed }">{{ task.title }}</span>
            <span v-if="!calendar.isTaskTitleEditing(task.id)" class="task-row-actions">
              <span v-if="calendar.scoreLabel(task)" class="score">{{ calendar.scoreLabel(task) }}</span>
              <button
                class="task-delete"
                type="button"
                aria-label="Удалить задачу"
                title="Удалить задачу"
                @click.stop.prevent="calendar.removeTaskById(task.id)"
              >
                <CircleX class="task-delete-icon" />
              </button>
            </span>
          </li>

          <li
            class="task-row add-row"
            :class="{
              'has-value':
                Boolean((calendar.dailyDrafts[day.dateKey] || '').trim()) ||
                Boolean(calendar.addTaskEditing[day.dateKey]),
            }"
            @click.stop
          >
            <button
              class="plus add-task-trigger add-task-check-trigger"
              type="button"
              @click.stop.prevent="calendar.startAddTaskEdit(day.dateKey)"
            >
              <Plus v-if="!calendar.addTaskEditing[day.dateKey]" class="add-task-plus-icon" />
            </button>
            <input
              v-if="calendar.addTaskEditing[day.dateKey]"
              v-model="calendar.dailyDrafts[day.dateKey]"
              class="add-input add-input-active"
              :data-add-input="day.dateKey"
              placeholder="Новая задача"
              @keydown.enter.prevent="calendar.addTaskForDay(day.dateKey)"
              @keydown.esc.prevent="calendar.cancelAddTaskEdit(day.dateKey, $event)"
              @blur="calendar.handleAddTaskBlur(day.dateKey)"
            />
            <button
              v-else
              class="add-input add-input-trigger"
              type="button"
              @click.stop.prevent="calendar.startAddTaskEdit(day.dateKey)"
            >
              Добавить задачу
            </button>
          </li>
        </ul>
      </section>

      <CalendarFinancePanel :date-key="day.dateKey" />
    </div>
  </article>
</template>
