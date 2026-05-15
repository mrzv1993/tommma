<script setup lang="ts">
import { ChevronDown, ChevronUp } from '@lucide/vue'

import { useCalendarBoardContext } from '@/app/calendar-board-context'
import type { DisplayEarning } from '@/app/project-model'

defineProps<{
  dateKey: string
  earning: DisplayEarning
}>()

const calendar = useCalendarBoardContext()
const periods = [
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'year', label: 'Год' },
] as const
</script>

<template>
  <li class="income-accordion">
    <div class="income-accordion-trigger" @click.stop>
      <button
        class="income-accordion-title income-title-button"
        type="button"
        @click.stop="calendar.toggleEarningExpanded(dateKey, earning.id)"
      >
        {{ calendar.displayProjectTitle(earning.projectName) }}
      </button>
      <span class="income-accordion-right" @mousedown.stop @click.stop>
        <input
          v-if="calendar.isEarningAmountEditing(dateKey, earning.id)"
          v-model="calendar.editingEarningAmounts[calendar.earningAmountEditKey(dateKey, earning.id)]"
          class="income-amount-edit"
          :data-earning-edit="calendar.earningAmountEditKey(dateKey, earning.id)"
          @mousedown.stop
          @click.stop
          @keydown.enter.prevent="calendar.handleEarningAmountEnter(dateKey, earning, $event)"
          @keydown.esc.prevent="calendar.handleEarningAmountEscape(dateKey, earning, $event)"
          @blur="calendar.handleEarningAmountBlur(dateKey, earning)"
        />
        <button
          v-else
          class="income-accordion-amount income-amount-hitbox"
          type="button"
          @mousedown.stop
          @dblclick.stop.prevent="calendar.startEarningAmountEdit(dateKey, earning)"
        >
          {{ calendar.formatMoney(earning.amount) }}
        </button>
      </span>
    </div>

    <div v-if="calendar.isEarningExpanded(dateKey, earning.id)" class="income-accordion-body">
      <ul class="income-stats">
        <li v-for="period in periods" :key="period.key" class="income-stat">
          <span>{{ period.label }}</span>
          <span class="income-stat-right">
            <strong class="income-stat-value-amount">
              {{ calendar.formatDelta(calendar.deltaByPeriod(dateKey, earning.projectName, period.key)) }}
            </strong>
            <strong
              class="income-stat-value-percent"
              :class="{
                positive: calendar.deltaPercentByPeriod(dateKey, earning.projectName, period.key) > 0,
                negative: calendar.deltaPercentByPeriod(dateKey, earning.projectName, period.key) < 0,
              }"
            >
              {{ calendar.formatPercent(calendar.deltaPercentByPeriod(dateKey, earning.projectName, period.key)) }}
              <ChevronUp
                v-if="calendar.deltaPercentByPeriod(dateKey, earning.projectName, period.key) > 0"
                class="income-stat-percent-icon"
              />
              <ChevronDown
                v-else-if="calendar.deltaPercentByPeriod(dateKey, earning.projectName, period.key) < 0"
                class="income-stat-percent-icon"
              />
            </strong>
          </span>
        </li>
      </ul>
    </div>
  </li>
</template>
