import { ref } from 'vue'

import { useAppLifecycle } from '@/app/app-lifecycle'
import { provideAppRootFeatureContexts } from '@/app/app-root-providers'
import { useAuthSession } from '@/app/auth-session'
import { useCalendarNavigationState } from '@/app/calendar-navigation-state'
import { useCalendarTaskState } from '@/app/calendar-task-state'
import { useClientCache } from '@/app/client-cache'
import { useDesktopTrayState } from '@/app/desktop-tray-state'
import { useDesktopUpdater } from '@/app/desktop-updater'
import { useFinanceState } from '@/app/finance-state'
import type { AppSection } from '@/app/navigation'
import { useProjectBoardState } from '@/app/project-board-state'
import { useProjectCardDndState } from '@/app/project-card-dnd-state'
import { useProjectSidebarLayoutState } from '@/app/project-sidebar-layout-state'
import { useProjectStoryState } from '@/app/project-story-state'
import { useSidebarSyncState } from '@/app/sidebar-sync-state'
import { useStatusMessages } from '@/app/status-messages'
import { useAppState } from '@/lib/app-state'

type SidebarSyncState = ReturnType<typeof useSidebarSyncState>

export function useAppRoot() {
  const status = useStatusMessages()
  const updater = useDesktopUpdater({
    clearMessages: status.clearMessages,
    setError: status.setError,
    setPersistentSuccess: status.setPersistentSuccess,
    setSuccess: status.setSuccess,
  })

  const activeSection = ref<AppSection>('board')
  const sidebarOpen = ref(false)
  const appNavCollapsed = ref(false)
  const selectedProjectKey = ref('')
  const nowMs = ref(Date.now())
  const board = useAppState()
  const clientCache = useClientCache()
  let sidebarSync: SidebarSyncState
  const getSidebarSync = () => sidebarSync
  const sidebarDirtyApi = {
    markSidebarStateDirty: () => {
      sidebarSync.markSidebarStateDirty()
    },
  }

  const projectLayout = useProjectSidebarLayoutState({ appNavCollapsed })
  const calendarNavigation = useCalendarNavigationState(board)
  const auth = useAuthSession({
    alignTodayColumnToRight: calendarNavigation.alignTodayColumnToRight,
    board,
    clearMessages: status.clearMessages,
    ensureClientCacheOwner: clientCache.ensureClientCacheOwner,
    sidebarSync: getSidebarSync,
    setError: status.setError,
    setSuccess: status.setSuccess,
  })
  const desktopTray = useDesktopTrayState({
    alignTodayColumnToRight: calendarNavigation.alignTodayColumnToRight,
    board,
    clearMessages: status.clearMessages,
    nowMs,
    selectedDateKey: calendarNavigation.selectedDateKey,
    setError: status.setError,
    slideDirection: calendarNavigation.slideDirection,
    user: auth.user,
  })
  const calendarTasks = useCalendarTaskState({
    board,
    nowMs,
    setError: status.setError,
    weekDays: calendarNavigation.weekDays,
  })
  const finance = useFinanceState({
    board,
    setError: status.setError,
    weekDays: calendarNavigation.weekDays,
  })
  const projectBoard = useProjectBoardState({
    selectedProjectKey,
    sidebarSync: sidebarDirtyApi,
  })
  const projectStory = useProjectStoryState({
    collectFinanceProjectMeta: finance.collectFinanceProjectMeta,
    deletedProjectCardIds: projectBoard.deletedProjectCardIds,
    deletedProjectSectionIds: projectBoard.deletedProjectSectionIds,
    projectBoardsByProject: projectBoard.projectBoardsByProject,
    saveProjectBoards: projectBoard.saveProjectBoards,
    selectedProjectKey,
    sidebarSync: sidebarDirtyApi,
  })
  sidebarSync = useSidebarSyncState({
    board,
    collectStoriesFromEarnings: projectStory.collectStoriesFromEarnings,
    deletedProjectCardIds: projectBoard.deletedProjectCardIds,
    deletedProjectSectionIds: projectBoard.deletedProjectSectionIds,
    deletedProjectStoryKeys: projectStory.deletedProjectStoryKeys,
    loadProjectBoards: projectBoard.loadProjectBoards,
    loadProjectSidebarWidth: projectLayout.loadProjectSidebarWidth,
    loadProjectStories: projectStory.loadProjectStories,
    projectBoardsByProject: projectBoard.projectBoardsByProject,
    projectSidebarWidth: projectLayout.projectSidebarWidth,
    projectStoriesState: projectStory.projectStoriesState,
    saveProjectBoards: projectBoard.saveProjectBoards,
    saveProjectStories: projectStory.saveProjectStories,
    selectedProjectKey,
    user: auth.user,
  })
  const projectDnd = useProjectCardDndState({
    saveProjectBoards: projectBoard.saveProjectBoards,
    selectedProjectBoard: projectBoard.selectedProjectBoard,
  })

  useAppLifecycle({
    board,
    cleanupTaskRowClickTimers: calendarTasks.cleanupTaskRowClickTimers,
    clearSuccessMessageTimeout: status.clearSuccessMessageTimeout,
    destroyDesktopTray: desktopTray.destroyDesktopTray,
    hydrateSession: auth.hydrateSession,
    nowMs,
    resetSidebarSyncState: sidebarSync.resetSidebarSyncState,
    startDesktopTray: desktopTray.startDesktopTray,
    startSidebarAutoSync: sidebarSync.startSidebarAutoSync,
    stopSidebarAutoSync: sidebarSync.stopSidebarAutoSync,
    syncDesktopTray: desktopTray.syncDesktopTray,
    syncSidebarOnForeground: sidebarSync.syncSidebarOnForeground,
    trayStateKey: desktopTray.trayStateKey,
  })

  provideAppRootFeatureContexts({
    calendarNavigation,
    calendarTasks,
    finance,
    projectBoard,
    projectDnd,
    projectLayout,
    projectStory,
    selectedProjectKey,
  })

  return {
    activeSection,
    appNavCollapsed,
    busy: auth.busy,
    email: auth.email,
    errorText: status.errorText,
    handleDesktopUpdate: updater.handleDesktopUpdate,
    handleLogout: auth.handleLogout,
    isDesktopRuntime:
      typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__'),
    loading: auth.loading,
    login: auth.login,
    mode: auth.mode,
    nickname: auth.nickname,
    notesInlineStyle: projectLayout.notesInlineStyle,
    password: auth.password,
    planUsername: auth.planUsername,
    registerPassword: auth.registerPassword,
    sidebarOpen,
    submitLogin: auth.submitLogin,
    submitRegister: auth.submitRegister,
    successText: status.successText,
    updaterBusy: updater.updaterBusy,
    user: auth.user,
  }
}
