import type { Ref } from 'vue'

import type { useCalendarNavigationState } from '@/app/calendar-navigation-state'
import type { useCalendarTaskState } from '@/app/calendar-task-state'
import type { CalendarBoardContextSource } from '@/app/calendar-board-context'
import { provideCalendarBoardContext } from '@/app/calendar-board-context'
import type { useFinanceState } from '@/app/finance-state'
import type { ProjectModalsContextSource } from '@/app/project-modals-context'
import { provideProjectModalsContext } from '@/app/project-modals-context'
import { displayProjectTitle, ROOT_SECTION_INSERT_TARGET } from '@/app/project-model'
import type { useProjectBoardState } from '@/app/project-board-state'
import type { useProjectCardDndState } from '@/app/project-card-dnd-state'
import type { useProjectSidebarLayoutState } from '@/app/project-sidebar-layout-state'
import type { ProjectSidebarContextSource } from '@/app/project-sidebar-context'
import { provideProjectSidebarContext } from '@/app/project-sidebar-context'
import type { useProjectStoryState } from '@/app/project-story-state'

type CalendarNavigationState = ReturnType<typeof useCalendarNavigationState>
type CalendarTaskState = ReturnType<typeof useCalendarTaskState>
type FinanceState = ReturnType<typeof useFinanceState>
type ProjectBoardState = ReturnType<typeof useProjectBoardState>
type ProjectDndState = ReturnType<typeof useProjectCardDndState>
type ProjectLayoutState = ReturnType<typeof useProjectSidebarLayoutState>
type ProjectStoryState = ReturnType<typeof useProjectStoryState>

type AppRootFeatureContexts = {
  calendarNavigation: CalendarNavigationState
  calendarTasks: CalendarTaskState
  finance: FinanceState
  projectBoard: ProjectBoardState
  projectDnd: ProjectDndState
  projectLayout: ProjectLayoutState
  projectStory: ProjectStoryState
  selectedProjectKey: Ref<string>
}

export function provideAppRootFeatureContexts({
  calendarNavigation,
  calendarTasks,
  finance,
  projectBoard,
  projectDnd,
  projectLayout,
  projectStory,
  selectedProjectKey,
}: AppRootFeatureContexts) {
  const calendarContext: CalendarBoardContextSource = {
    ...calendarTasks,
    ...finance,
    boardInlineStyle: projectLayout.boardInlineStyle,
    daysScrollRef: calendarNavigation.daysScrollRef,
    daysTransitionName: calendarNavigation.daysTransitionName,
    displayProjectTitle,
    setTodayWithAnimation: calendarNavigation.setTodayWithAnimation,
    shiftDays: calendarNavigation.shiftDays,
    weekDays: calendarNavigation.weekDays,
  }

  const projectSidebarContext: ProjectSidebarContextSource = {
    ...projectBoard,
    ...projectDnd,
    ...projectStory,
    projectSidebarInlineStyle: projectLayout.projectSidebarInlineStyle,
    ROOT_SECTION_INSERT_TARGET,
    selectedProjectKey,
    startSidebarResize: projectLayout.startSidebarResize,
  }

  const projectModalsContext: ProjectModalsContextSource = {
    ...projectBoard,
    ...projectStory,
  }

  provideCalendarBoardContext(calendarContext)
  provideProjectSidebarContext(projectSidebarContext)
  provideProjectModalsContext(projectModalsContext)
}
