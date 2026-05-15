import { onBeforeUnmount, onMounted, type Ref, watch } from 'vue'

import type { useAppState } from '@/lib/app-state'

type BoardController = ReturnType<typeof useAppState>

type AppLifecycleOptions = {
  board: BoardController
  cleanupTaskRowClickTimers: () => void
  clearSuccessMessageTimeout: () => void
  destroyDesktopTray: () => void
  hydrateSession: () => Promise<void>
  nowMs: Ref<number>
  resetSidebarSyncState: () => void
  startDesktopTray: () => void
  startSidebarAutoSync: () => void
  stopSidebarAutoSync: () => void
  syncDesktopTray: () => void
  syncSidebarOnForeground: () => void
  trayStateKey: Ref<unknown>
}

export function useAppLifecycle(options: AppLifecycleOptions) {
  let tickInterval: number | null = null

  onMounted(() => {
    tickInterval = window.setInterval(() => {
      options.nowMs.value = Date.now()
    }, 1000)
    options.startDesktopTray()
    void options.hydrateSession()
    options.startSidebarAutoSync()
    window.addEventListener('focus', options.syncSidebarOnForeground)
    document.addEventListener('visibilitychange', options.syncSidebarOnForeground)
  })

  watch(options.trayStateKey, () => {
    options.syncDesktopTray()
  })

  onBeforeUnmount(() => {
    if (tickInterval) {
      window.clearInterval(tickInterval)
      tickInterval = null
    }
    options.stopSidebarAutoSync()
    options.board.stopAutoSync()
    window.removeEventListener('focus', options.syncSidebarOnForeground)
    document.removeEventListener('visibilitychange', options.syncSidebarOnForeground)
    options.cleanupTaskRowClickTimers()
    options.destroyDesktopTray()
    options.clearSuccessMessageTimeout()
    options.resetSidebarSyncState()
  })
}
