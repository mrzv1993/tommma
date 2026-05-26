import { watch, type Ref } from 'vue'

import { ApiRequestError, api, type SessionUser, type SidebarState } from '@/lib/api'
import type { useAppState } from '@/lib/app-state'
import { shouldUploadLocalCacheWhenServerEmpty } from '@/app/server-authoritative-sync'
import {
  PROJECT_BOARDS_STORAGE_KEY,
  PROJECT_DELETED_CARDS_STORAGE_KEY,
  PROJECT_DELETED_SECTIONS_STORAGE_KEY,
  PROJECT_DELETED_STORIES_STORAGE_KEY,
  PROJECT_SIDEBAR_MAX_WIDTH,
  PROJECT_SIDEBAR_MIN_WIDTH,
  PROJECT_SIDEBAR_WIDTH_STORAGE_KEY,
  PROJECT_STORIES_STORAGE_KEY,
  type ProjectBoardState,
} from '@/app/project-model'

type BoardController = ReturnType<typeof useAppState>

type SidebarSyncStateOptions = {
  board: BoardController
  deletedProjectCardIds: Ref<Record<string, number>>
  deletedProjectSectionIds: Ref<Record<string, number>>
  deletedProjectStoryKeys: Ref<Record<string, number>>
  projectBoardsByProject: Record<string, ProjectBoardState>
  projectSidebarWidth: Ref<number>
  projectStoriesState: Ref<Array<{ key: string; name: string }>>
  saveProjectBoards: () => void
  saveProjectStories: () => void
  selectedProjectKey: Ref<string>
  user: Ref<SessionUser | null>
}

export function useSidebarSyncState(options: SidebarSyncStateOptions) {
  let sidebarSyncInterval: number | null = null
  let sidebarSyncRetryTimeout: number | null = null
  let sidebarSyncInFlight = false
  let sidebarSyncPendingAfterFlight = false
  let sidebarSyncDirty = false
  let sidebarServerUpdatedAt: string | null = null
  let sidebarStateHydrating = false

  function markDeleted(map: Record<string, number>, id: string, deletedAt: number = Date.now()) {
    if (!id) return
    map[id] = Math.max(map[id] || 0, deletedAt)
  }

  function normalizeDeletedSidebarIds(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== 'object') return {}
    const result: Record<string, number> = {}
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const deletedAt = Number(value)
      if (id && Number.isFinite(deletedAt) && deletedAt >= 0) {
        result[id] = deletedAt
      }
    }
    return result
  }

  function loadDeletedSidebarIds(storageKey: string): Record<string, number> {
    try {
      return normalizeDeletedSidebarIds(JSON.parse(window.localStorage.getItem(storageKey) || '{}'))
    } catch {
      return {}
    }
  }

  function saveDeletedSidebarIds() {
    window.localStorage.setItem(PROJECT_DELETED_STORIES_STORAGE_KEY, JSON.stringify(options.deletedProjectStoryKeys.value))
    window.localStorage.setItem(PROJECT_DELETED_SECTIONS_STORAGE_KEY, JSON.stringify(options.deletedProjectSectionIds.value))
    window.localStorage.setItem(PROJECT_DELETED_CARDS_STORAGE_KEY, JSON.stringify(options.deletedProjectCardIds.value))
  }

  function mergeDeletedSidebarIds(left: Record<string, number>, right: Record<string, number>) {
    const merged = { ...left }
    for (const [id, deletedAt] of Object.entries(right)) {
      merged[id] = Math.max(merged[id] || 0, deletedAt)
    }
    return merged
  }

  function buildSidebarStatePayload(): SidebarState {
    return {
      stories: options.projectStoriesState.value.map((story) => ({ key: story.key, name: story.name })),
      boards: JSON.parse(JSON.stringify(options.projectBoardsByProject)) as SidebarState['boards'],
      deletedStoryKeys: options.deletedProjectStoryKeys.value,
      deletedSectionIds: options.deletedProjectSectionIds.value,
      deletedCardIds: options.deletedProjectCardIds.value,
      sidebarWidth: options.projectSidebarWidth.value,
      baseUpdatedAt: sidebarServerUpdatedAt,
    }
  }

  function isSidebarStateEffectivelyEmpty(state: SidebarState) {
    return (
      state.stories.length === 0 &&
      Object.keys(state.boards || {}).length === 0 &&
      Object.keys(state.deletedStoryKeys || {}).length === 0 &&
      Object.keys(state.deletedSectionIds || {}).length === 0 &&
      Object.keys(state.deletedCardIds || {}).length === 0
    )
  }

  function hasLocalSidebarData() {
    return (
      options.projectStoriesState.value.length > 0 ||
      Object.keys(options.projectBoardsByProject).length > 0 ||
      Object.keys(options.deletedProjectStoryKeys.value).length > 0 ||
      Object.keys(options.deletedProjectSectionIds.value).length > 0 ||
      Object.keys(options.deletedProjectCardIds.value).length > 0
    )
  }

  function applySidebarState(state: SidebarState) {
    sidebarStateHydrating = true
    try {
      sidebarServerUpdatedAt = state.updatedAt ?? null
      const deletedStoryKeys = normalizeDeletedSidebarIds(state.deletedStoryKeys || {})
      const deletedSectionIds = normalizeDeletedSidebarIds(state.deletedSectionIds || {})
      const deletedCardIds = normalizeDeletedSidebarIds(state.deletedCardIds || {})
      options.deletedProjectStoryKeys.value = deletedStoryKeys
      options.deletedProjectSectionIds.value = deletedSectionIds
      options.deletedProjectCardIds.value = deletedCardIds
      options.projectStoriesState.value = state.stories
        .filter((story) => !deletedStoryKeys[story.key])
        .map((story) => ({ key: story.key, name: story.name }))
      for (const key of Object.keys(options.projectBoardsByProject)) {
        delete options.projectBoardsByProject[key]
      }
      for (const [projectKey, boardState] of Object.entries(state.boards)) {
        if (deletedStoryKeys[projectKey]) continue
        options.projectBoardsByProject[projectKey] = {
          sections: boardState.sections
            .filter((section) => !deletedSectionIds[section.id])
            .map((section) => ({ ...section })),
          cards: boardState.cards
            .filter((card) => !deletedCardIds[card.id] && !deletedSectionIds[card.sectionId])
            .map((card) => ({ ...card, completed: Boolean(card.completed) })),
        }
      }
      options.projectSidebarWidth.value = Math.max(
        PROJECT_SIDEBAR_MIN_WIDTH,
        Math.min(PROJECT_SIDEBAR_MAX_WIDTH, state.sidebarWidth),
      )
    } finally {
      sidebarStateHydrating = false
    }
  }

  function timestampValue(value?: string | null) {
    if (!value) return 0
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : 0
  }

  function mergeSidebarState(server: SidebarState, local: SidebarState): SidebarState {
    const deletedStoryKeys = mergeDeletedSidebarIds(server.deletedStoryKeys || {}, local.deletedStoryKeys || {})
    const deletedSectionIds = mergeDeletedSidebarIds(server.deletedSectionIds || {}, local.deletedSectionIds || {})
    const deletedCardIds = mergeDeletedSidebarIds(server.deletedCardIds || {}, local.deletedCardIds || {})
    const storiesByKey = new Map(server.stories.map((story) => [story.key, { ...story }]))
    for (const story of local.stories) {
      storiesByKey.set(story.key, { ...story })
    }
    for (const key of Object.keys(deletedStoryKeys)) {
      storiesByKey.delete(key)
    }

    const boards: SidebarState['boards'] = JSON.parse(JSON.stringify(server.boards || {}))
    for (const [projectKey, localBoard] of Object.entries(local.boards || {})) {
      if (deletedStoryKeys[projectKey]) continue
      const serverBoard = boards[projectKey] || { sections: [], cards: [] }
      const sectionsById = new Map(serverBoard.sections.map((section) => [section.id, { ...section }]))
      for (const section of localBoard.sections) {
        const existing = sectionsById.get(section.id)
        if (!existing || timestampValue(section.updatedAt) >= timestampValue(existing.updatedAt)) {
          sectionsById.set(section.id, { ...section })
        }
      }
      for (const sectionId of Object.keys(deletedSectionIds)) {
        sectionsById.delete(sectionId)
      }

      const cardsById = new Map(serverBoard.cards.map((card) => [card.id, { ...card }]))
      for (const card of localBoard.cards) {
        const existing = cardsById.get(card.id)
        if (!existing || timestampValue(card.updatedAt) >= timestampValue(existing.updatedAt)) {
          cardsById.set(card.id, { ...card })
        }
      }
      for (const cardId of Object.keys(deletedCardIds)) {
        cardsById.delete(cardId)
      }

      boards[projectKey] = {
        sections: [...sectionsById.values()],
        cards: [...cardsById.values()].filter((card) => !deletedSectionIds[card.sectionId]),
      }
    }
    for (const projectKey of Object.keys(deletedStoryKeys)) {
      delete boards[projectKey]
    }

    return {
      stories: [...storiesByKey.values()],
      boards,
      deletedStoryKeys,
      deletedSectionIds,
      deletedCardIds,
      sidebarWidth: local.sidebarWidth,
      updatedAt: server.updatedAt,
      baseUpdatedAt: server.updatedAt,
    }
  }

  function persistSidebarStateToLocalCache() {
    window.localStorage.setItem(PROJECT_STORIES_STORAGE_KEY, JSON.stringify(options.projectStoriesState.value))
    window.localStorage.setItem(PROJECT_BOARDS_STORAGE_KEY, JSON.stringify(options.projectBoardsByProject))
    window.localStorage.setItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY, String(options.projectSidebarWidth.value))
    saveDeletedSidebarIds()
  }

  function scheduleSidebarStateSync(delayMs = 0) {
    if (sidebarSyncRetryTimeout) {
      window.clearTimeout(sidebarSyncRetryTimeout)
    }
    sidebarSyncRetryTimeout = window.setTimeout(() => {
      sidebarSyncRetryTimeout = null
      void syncSidebarState()
    }, delayMs)
  }

  function markSidebarStateDirty() {
    if (sidebarStateHydrating) return
    if (!options.user.value) return
    sidebarSyncDirty = true
    scheduleSidebarStateSync(250)
  }

  watch(
    options.projectSidebarWidth,
    () => {
      markSidebarStateDirty()
    },
    { flush: 'sync' },
  )

  function resetSidebarSyncState() {
    sidebarSyncDirty = false
    sidebarSyncInFlight = false
    sidebarSyncPendingAfterFlight = false
    sidebarServerUpdatedAt = null
    if (sidebarSyncRetryTimeout) {
      window.clearTimeout(sidebarSyncRetryTimeout)
      sidebarSyncRetryTimeout = null
    }
  }

  async function syncSidebarState() {
    if (!options.user.value) return
    if (sidebarStateHydrating) return
    if (sidebarSyncInFlight) {
      sidebarSyncPendingAfterFlight = true
      return
    }

    sidebarSyncInFlight = true
    try {
      if (sidebarSyncDirty) {
        const localPayload = buildSidebarStatePayload()
        let result: Awaited<ReturnType<typeof api.putSidebarState>>
        try {
          result = await api.putSidebarState(localPayload)
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 409) {
            const current = (error.payload as { sidebar?: SidebarState } | undefined)?.sidebar
            if (current) {
              const merged = mergeSidebarState(current, localPayload)
              applySidebarState(merged)
              persistSidebarStateToLocalCache()
              sidebarSyncDirty = true
              scheduleSidebarStateSync(0)
              return
            }
          }
          throw error
        }
        applySidebarState(result.sidebar)
        persistSidebarStateToLocalCache()
        sidebarSyncDirty = false
      } else {
        const result = await api.getSidebarState()
        if (
          shouldUploadLocalCacheWhenServerEmpty({
            allowExplicitImport: false,
            hasLocalData: hasLocalSidebarData(),
            serverStateIsEmpty: isSidebarStateEffectivelyEmpty(result.sidebar),
          })
        ) {
          sidebarSyncDirty = true
          scheduleSidebarStateSync(0)
          return
        }
        applySidebarState(result.sidebar)
        persistSidebarStateToLocalCache()
      }
    } catch {
      scheduleSidebarStateSync(sidebarSyncDirty ? 2000 : 5000)
    } finally {
      sidebarSyncInFlight = false
      if (sidebarSyncPendingAfterFlight) {
        sidebarSyncPendingAfterFlight = false
        scheduleSidebarStateSync(0)
      }
    }
  }

  async function loadSidebarStateFromServer() {
    if (!options.user.value) return
    try {
      const result = await api.getSidebarState()
      applySidebarState(result.sidebar)
      persistSidebarStateToLocalCache()
      sidebarSyncDirty = false
      return
    } catch {
      // If server is temporarily unreachable, keep the current in-memory state and retry.
      scheduleSidebarStateSync(2000)
    }
  }

  function syncSidebarOnForeground() {
    if (!options.user.value) return
    if (document.visibilityState === 'hidden') return
    void options.board.syncFromServer().catch(() => {})
    void syncSidebarState()
  }

  function startSidebarAutoSync() {
    if (sidebarSyncInterval) return
    sidebarSyncInterval = window.setInterval(() => {
      if (!options.user.value) return
      void syncSidebarState()
    }, 10000)
  }

  function stopSidebarAutoSync() {
    if (!sidebarSyncInterval) return
    window.clearInterval(sidebarSyncInterval)
    sidebarSyncInterval = null
  }

  return {
    applySidebarState,
    buildSidebarStatePayload,
    hasLocalSidebarData,
    isSidebarStateEffectivelyEmpty,
    loadDeletedSidebarIds,
    loadSidebarStateFromServer,
    markDeleted,
    markSidebarStateDirty,
    mergeDeletedSidebarIds,
    mergeSidebarState,
    normalizeDeletedSidebarIds,
    persistSidebarStateToLocalCache,
    resetSidebarSyncState,
    saveDeletedSidebarIds,
    scheduleSidebarStateSync,
    startSidebarAutoSync,
    stopSidebarAutoSync,
    syncSidebarOnForeground,
    syncSidebarState,
    timestampValue,
  }
}
