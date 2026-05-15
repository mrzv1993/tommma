<script setup lang="ts">
import CalendarEarningAccordion from '@/components/board/CalendarEarningAccordion.vue'
import { useCalendarBoardContext } from '@/app/calendar-board-context'

defineProps<{
  dateKey: string
}>()

const calendar = useCalendarBoardContext()
const periods = [
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'year', label: 'Год' },
] as const
</script>

<template>
  <section class="day-income" @click.stop>
    <button
      class="finance-total"
      type="button"
      :aria-expanded="calendar.isFinanceTotalExpanded(dateKey)"
      @click.stop="calendar.toggleFinanceTotalExpanded(dateKey)"
    >
      <span>Итого</span>
      <strong>{{ calendar.formatMoney(calendar.dayIncomeTotal(dateKey)) }}</strong>
    </button>
    <div v-if="calendar.isFinanceTotalExpanded(dateKey)" class="finance-total-body">
      <ul class="finance-total-stats">
        <li v-for="period in periods" :key="period.key" class="finance-total-stat">
          <span>{{ period.label }}</span>
          <strong
            :class="{
              positive: calendar.periodNetByDate(dateKey, period.key) > 0,
              negative: calendar.periodNetByDate(dateKey, period.key) < 0,
            }"
          >
            {{ calendar.formatSignedMoney(calendar.periodNetByDate(dateKey, period.key)) }}
          </strong>
        </li>
      </ul>
    </div>
    <ul class="income-list">
      <CalendarEarningAccordion
        v-for="earning in calendar.earningsByDay.get(dateKey) || []"
        :key="`earning-${earning.id}`"
        :date-key="dateKey"
        :earning="earning"
      />
    </ul>
  </section>
</template>
