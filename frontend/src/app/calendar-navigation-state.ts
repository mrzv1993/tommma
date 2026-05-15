import { computed, ref } from 'vue'

import type { useAppState } from '@/lib/app-state'
import {
  addDays,
  daysDiff,
  formatDateLabel,
  formatFullDateLabel,
  parseDateKey,
  toDateKey,
} from '@/app/date-utils'

type BoardController = ReturnType<typeof useAppState>

export function useCalendarNavigationState(board: BoardController) {
  const selectedDateKey = board.selectedDateKey
  const daysScrollRef = ref<HTMLElement | null>(null)
  const slideDirection = ref<'left' | 'right'>('left')
  const daysTransitionName = computed(() =>
    slideDirection.value === 'left' ? 'days-left' : 'days-right',
  )

  const weekDays = computed(() => {
    const end = parseDateKey(selectedDateKey.value)
    const start = addDays(end, -3)
    return Array.from({ length: 4 }, (_, i) => {
      const date = addDays(start, i)
      const key = toDateKey(date)
      return {
        dateKey: key,
        title: formatDateLabel(key),
        fullTitle: formatFullDateLabel(key),
        isToday: key === toDateKey(new Date()),
        isSelected: key === selectedDateKey.value,
      }
    })
  })

  async function shiftDays(delta: number) {
    if (!delta) return
    slideDirection.value = delta > 0 ? 'left' : 'right'
    await board.shiftDate(delta)
  }

  async function setTodayWithAnimation() {
    const today = toDateKey(new Date())
    const diff = daysDiff(selectedDateKey.value, today)
    if (!diff) return
    slideDirection.value = diff > 0 ? 'left' : 'right'
    await board.setToday()
  }

  function alignTodayColumnToRight() {
    const container = daysScrollRef.value
    if (!container) return

    const todayKey = toDateKey(new Date())
    const todayColumn = container.querySelector<HTMLElement>(`[data-date-key="${todayKey}"]`)
    if (!todayColumn) return

    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
    const targetScrollLeft = todayColumn.offsetLeft + todayColumn.offsetWidth - container.clientWidth
    container.scrollLeft = Math.min(Math.max(0, targetScrollLeft), maxScrollLeft)
  }

  return {
    alignTodayColumnToRight,
    daysScrollRef,
    daysTransitionName,
    selectedDateKey,
    setTodayWithAnimation,
    shiftDays,
    slideDirection,
    weekDays,
  }
}
