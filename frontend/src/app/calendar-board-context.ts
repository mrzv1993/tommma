import { inject, provide, reactive, type UnwrapNestedRefs } from 'vue'

import type { useCalendarNavigationState } from '@/app/calendar-navigation-state'
import type { useCalendarTaskState } from '@/app/calendar-task-state'
import type { useFinanceState } from '@/app/finance-state'
import type { displayProjectTitle } from '@/app/project-model'
import type { useProjectSidebarLayoutState } from '@/app/project-sidebar-layout-state'

type CalendarNavigationState = ReturnType<typeof useCalendarNavigationState>
type CalendarTaskState = ReturnType<typeof useCalendarTaskState>
type FinanceState = ReturnType<typeof useFinanceState>
type ProjectLayoutState = ReturnType<typeof useProjectSidebarLayoutState>

export type CalendarBoardContextSource = Pick<
  CalendarTaskState,
  | 'addTaskEditing'
  | 'addTaskForDay'
  | 'cancelAddTaskEdit'
  | 'dailyDrafts'
  | 'dayPercent'
  | 'editingTaskTitles'
  | 'handleAddTaskBlur'
  | 'handleTaskRowClick'
  | 'handleTaskTitleBlur'
  | 'handleTaskTitleEnter'
  | 'handleTaskTitleEscape'
  | 'isTaskTitleEditing'
  | 'removeTaskById'
  | 'scoreLabel'
  | 'startAddTaskEdit'
  | 'startTaskTitleEdit'
  | 'tasksByDay'
> &
  Pick<
    FinanceState,
    | 'dayIncomeTotal'
    | 'deltaByPeriod'
    | 'deltaPercentByPeriod'
    | 'earningAmountEditKey'
    | 'earningsByDay'
    | 'editingEarningAmounts'
    | 'formatDelta'
    | 'formatMoney'
    | 'formatPercent'
    | 'formatSignedMoney'
    | 'handleEarningAmountBlur'
    | 'handleEarningAmountEnter'
    | 'handleEarningAmountEscape'
    | 'isEarningAmountEditing'
    | 'isEarningExpanded'
    | 'isFinanceTotalExpanded'
    | 'periodNetByDate'
    | 'startEarningAmountEdit'
    | 'toggleEarningExpanded'
    | 'toggleFinanceTotalExpanded'
  > &
  Pick<CalendarNavigationState, 'daysScrollRef' | 'daysTransitionName' | 'setTodayWithAnimation' | 'shiftDays' | 'weekDays'> &
  Pick<ProjectLayoutState, 'boardInlineStyle'> & {
    displayProjectTitle: typeof displayProjectTitle
  }

export type CalendarBoardContext = UnwrapNestedRefs<CalendarBoardContextSource>

const CALENDAR_BOARD_CONTEXT_KEY = Symbol('CalendarBoardContext')

export function provideCalendarBoardContext(context: CalendarBoardContextSource) {
  provide(CALENDAR_BOARD_CONTEXT_KEY, reactive(context))
}

export function useCalendarBoardContext() {
  const context = inject<CalendarBoardContext>(CALENDAR_BOARD_CONTEXT_KEY)
  if (!context) {
    throw new Error('Calendar board context is not available')
  }
  return context
}
