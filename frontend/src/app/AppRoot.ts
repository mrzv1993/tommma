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
import { useUserPreferencesState } from '@/app/user-preferences-state'
import { api } from '@/lib/api'
import { useAppState } from '@/lib/app-state'

type SidebarSyncState = ReturnType<typeof useSidebarSyncState>
type ExportSourceResult =
  | {
      ok: true
      data: unknown
    }
  | {
      ok: false
      error: string
    }

const DESKTOP_EXPORT_STORAGE_KEY = 'tommma.desktopExport.last.v1'
const REDACTED_LOCAL_STORAGE_KEYS = new Set(['tommma.auth.token.v1'])

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function collectLocalStorageSnapshot() {
  const snapshot: Record<string, unknown> = {}
  if (typeof window === 'undefined') return snapshot

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key) continue
    const value = window.localStorage.getItem(key)
    snapshot[key] = REDACTED_LOCAL_STORAGE_KEYS.has(key)
      ? {
          redacted: true,
          length: value?.length ?? 0,
        }
      : value
  }

  return snapshot
}

async function collectExportSource(name: string, load: () => Promise<unknown>): Promise<[string, ExportSourceResult]> {
  try {
    return [
      name,
      {
        ok: true,
        data: await load(),
      },
    ]
  } catch (error) {
    return [
      name,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

async function collectServerSnapshot() {
  const entries = await Promise.all([
    collectExportSource('session', () => api.session()),
    collectExportSource('tasks', () => api.getTasks()),
    collectExportSource('earnings', () => api.getEarnings()),
    collectExportSource('sidebarState', () => api.getSidebarState()),
    collectExportSource('notesState', () => api.getNotesState()),
    collectExportSource('planState', () => api.getPlanState()),
    collectExportSource('userPreferences', () => api.getUserPreferences()),
  ])

  return Object.fromEntries(entries)
}

function downloadJsonFile(json: string, fileName: string) {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return true
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

export function useAppRoot() {
  const status = useStatusMessages()
  const updater = useDesktopUpdater({
    clearMessages: status.clearMessages,
    setError: status.setError,
    setPersistentSuccess: status.setPersistentSuccess,
    setSuccess: status.setSuccess,
  })

  const activeSection = ref<AppSection>('main')
  const sidebarOpen = ref(false)
  const appNavCollapsed = ref(false)
  const selectedProjectKey = ref('')
  const exportBusy = ref(false)
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
  const userPreferences = useUserPreferencesState({
    setError: status.setError,
    user: auth.user,
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
    deletedProjectCardIds: projectBoard.deletedProjectCardIds,
    deletedProjectSectionIds: projectBoard.deletedProjectSectionIds,
    deletedProjectStoryKeys: projectStory.deletedProjectStoryKeys,
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
    hydrateSession: async () => {
      await auth.hydrateSession()
      await userPreferences.loadUserPreferencesFromServer()
    },
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

  async function submitLogin() {
    await auth.submitLogin()
    await userPreferences.loadUserPreferencesFromServer()
    activeSection.value = 'main'
  }

  async function submitRegister() {
    await auth.submitRegister()
    await userPreferences.loadUserPreferencesFromServer()
    activeSection.value = 'main'
  }

  async function handleLogout() {
    await auth.handleLogout()
    userPreferences.resetUserPreferences()
    activeSection.value = 'main'
  }

  async function exportDesktopData() {
    if (exportBusy.value) return
    exportBusy.value = true
    status.clearMessages()

    try {
      const createdAt = new Date()
      const payload = {
        kind: 'tommma-desktop-state-export',
        exportedAt: createdAt.toISOString(),
        runtime: {
          userAgent: navigator.userAgent,
          isDesktopRuntime:
            typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__'),
          location: window.location.href,
        },
        currentState: {
          activeSection: activeSection.value,
          appNavCollapsed: appNavCollapsed.value,
          sidebarOpen: sidebarOpen.value,
          selectedProjectKey: selectedProjectKey.value,
          selectedDateKey: calendarNavigation.selectedDateKey.value,
          weekDays: jsonClone(calendarNavigation.weekDays.value),
          navOrder: jsonClone(userPreferences.navOrder.value),
          user: jsonClone(auth.user.value),
          board: {
            tasks: jsonClone(board.state.value.tasks),
            dailyEarningsByDate: jsonClone(board.getDailyEarningsMap()),
          },
          projects: {
            stories: jsonClone(projectStory.projectStoriesState.value),
            boardsByProject: jsonClone(projectBoard.projectBoardsByProject),
            deletedStoryKeys: jsonClone(projectStory.deletedProjectStoryKeys.value),
            deletedSectionIds: jsonClone(projectBoard.deletedProjectSectionIds.value),
            deletedCardIds: jsonClone(projectBoard.deletedProjectCardIds.value),
            sidebarWidth: projectLayout.projectSidebarWidth.value,
          },
        },
        localStorage: collectLocalStorageSnapshot(),
        serverSnapshot: await collectServerSnapshot(),
      }
      const json = JSON.stringify(payload, null, 2)
      const safeTimestamp = createdAt.toISOString().replace(/[:.]/g, '-')
      const fileName = `tommma-desktop-export-${safeTimestamp}.json`
      const delivery = {
        downloaded: false,
        copiedToClipboard: false,
        savedToLocalStorage: false,
      }

      try {
        downloadJsonFile(json, fileName)
        delivery.downloaded = true
      } catch {
        delivery.downloaded = false
      }

      try {
        delivery.copiedToClipboard = await copyTextToClipboard(json)
      } catch {
        delivery.copiedToClipboard = false
      }

      try {
        window.localStorage.setItem(DESKTOP_EXPORT_STORAGE_KEY, json)
        delivery.savedToLocalStorage = true
      } catch {
        delivery.savedToLocalStorage = false
      }

      const deliveryText = [
        delivery.downloaded ? 'файл скачан' : '',
        delivery.copiedToClipboard ? 'JSON скопирован в буфер' : '',
        delivery.savedToLocalStorage ? 'копия сохранена в localStorage' : '',
      ]
        .filter(Boolean)
        .join(', ')
      status.setPersistentSuccess(`Экспорт готов: ${deliveryText || fileName}`)
    } catch (error) {
      status.setError(error instanceof Error ? error.message : 'Не удалось экспортировать данные')
    } finally {
      exportBusy.value = false
    }
  }

  return {
    activeSection,
    appNavCollapsed,
    busy: auth.busy,
    email: auth.email,
    errorText: status.errorText,
    exportBusy,
    exportDesktopData,
    handleDesktopUpdate: updater.handleDesktopUpdate,
    handleLogout,
    isDesktopRuntime:
      typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__'),
    loading: auth.loading,
    login: auth.login,
    mode: auth.mode,
    navOrder: userPreferences.navOrder,
    nickname: auth.nickname,
    notesInlineStyle: projectLayout.notesInlineStyle,
    password: auth.password,
    planUsername: auth.planUsername,
    registerPassword: auth.registerPassword,
    reorderNavSection: userPreferences.reorderNavSection,
    sidebarOpen,
    submitLogin,
    submitRegister,
    successText: status.successText,
    updaterBusy: updater.updaterBusy,
    user: auth.user,
  }
}
