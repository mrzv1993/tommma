<script lang="ts">
import { defineComponent } from 'vue'

import { useCalendarBoardContext } from '@/app/calendar-board-context'
import CalendarDayColumn from '@/components/board/CalendarDayColumn.vue'

export default defineComponent({
  name: 'CalendarBoard',
  components: {
    CalendarDayColumn,
  },
  setup() {
    return useCalendarBoardContext()
  },
})
</script>

<template>
  <section class="board" :style="boardInlineStyle">
    <div ref="daysScrollRef" class="days-scroll">
      <TransitionGroup :name="daysTransitionName" tag="div" class="days-track">
        <CalendarDayColumn v-for="day in weekDays" :key="day.dateKey" :day="day" />
      </TransitionGroup>
    </div>

    <nav class="nav-controls">
      <button @click="shiftDays(-7)">«</button>
      <button @click="shiftDays(-1)">‹</button>
      <button @click="setTodayWithAnimation()">•</button>
      <button @click="shiftDays(1)">›</button>
      <button @click="shiftDays(7)">»</button>
    </nav>
  </section>
</template>
