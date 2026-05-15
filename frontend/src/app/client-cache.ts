import {
  CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY,
  DELETED_NOTES_STORAGE_KEY,
  NOTES_SIDEBAR_WIDTH_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  PROJECT_BOARDS_STORAGE_KEY,
  PROJECT_DELETED_CARDS_STORAGE_KEY,
  PROJECT_DELETED_SECTIONS_STORAGE_KEY,
  PROJECT_DELETED_STORIES_STORAGE_KEY,
  PROJECT_SIDEBAR_WIDTH_STORAGE_KEY,
  PROJECT_STORIES_STORAGE_KEY,
  PROJECT_TASKS_STORAGE_KEY,
} from '@/app/project-model'

export function useClientCache() {
  function clearClientLocalCaches() {
    window.localStorage.removeItem(PROJECT_TASKS_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_STORIES_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_BOARDS_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_DELETED_STORIES_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_DELETED_SECTIONS_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_DELETED_CARDS_STORAGE_KEY)
    window.localStorage.removeItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY)
    window.localStorage.removeItem(NOTES_STORAGE_KEY)
    window.localStorage.removeItem(DELETED_NOTES_STORAGE_KEY)
    window.localStorage.removeItem(NOTES_SIDEBAR_WIDTH_STORAGE_KEY)
  }

  function ensureClientCacheOwner(userId: string) {
    const owner = window.localStorage.getItem(CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY)
    if (owner && owner !== userId) {
      clearClientLocalCaches()
    }
    window.localStorage.setItem(CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY, userId)
  }

  return {
    clearClientLocalCaches,
    ensureClientCacheOwner,
  }
}
