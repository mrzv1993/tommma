import { ref, type Ref } from 'vue'

import { DEFAULT_APP_NAV_ORDER, normalizeAppNavOrder, type AppSection } from '@/app/navigation'
import { ApiRequestError, api, type SessionUser, type UserPreferences } from '@/lib/api'

type UserPreferencesStateOptions = {
  setError: (message: string) => void
  user: Ref<SessionUser | null>
}

export function useUserPreferencesState(options: UserPreferencesStateOptions) {
  const navOrder = ref<AppSection[]>([...DEFAULT_APP_NAV_ORDER])
  const preferencesUpdatedAt = ref<string | null>(null)
  let preferencesSyncInFlight = false
  let preferencesSyncPending: AppSection[] | null = null

  function applyUserPreferences(preferences: UserPreferences) {
    navOrder.value = normalizeAppNavOrder(preferences.navOrder || [])
    preferencesUpdatedAt.value = preferences.updatedAt ?? null
  }

  function resetUserPreferences() {
    navOrder.value = [...DEFAULT_APP_NAV_ORDER]
    preferencesUpdatedAt.value = null
    preferencesSyncPending = null
    preferencesSyncInFlight = false
  }

  async function loadUserPreferencesFromServer() {
    if (!options.user.value) {
      resetUserPreferences()
      return
    }
    try {
      const result = await api.getUserPreferences()
      applyUserPreferences(result.preferences)
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось загрузить настройки навигации')
    }
  }

  async function persistNavOrder(order: AppSection[]) {
    if (!options.user.value) return
    if (preferencesSyncInFlight) {
      preferencesSyncPending = order
      return
    }

    preferencesSyncInFlight = true
    try {
      const result = await api.putUserPreferences({
        navOrder: order,
        baseUpdatedAt: preferencesUpdatedAt.value,
      })
      applyUserPreferences(result.preferences)
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        const current = (error.payload as { preferences?: UserPreferences } | undefined)?.preferences
        if (current) {
          applyUserPreferences(current)
          preferencesSyncPending = order
          return
        }
      }
      options.setError(error instanceof Error ? error.message : 'Не удалось сохранить порядок навигации')
    } finally {
      preferencesSyncInFlight = false
      if (preferencesSyncPending) {
        const pending = preferencesSyncPending
        preferencesSyncPending = null
        void persistNavOrder(pending)
      }
    }
  }

  function reorderNavSection(draggedSection: AppSection, targetSection: AppSection) {
    if (draggedSection === targetSection) return
    const current = normalizeAppNavOrder(navOrder.value)
    const draggedIndex = current.indexOf(draggedSection)
    const targetIndex = current.indexOf(targetSection)
    if (draggedIndex < 0 || targetIndex < 0) return
    const nextOrder = [...current]
    const [item] = nextOrder.splice(draggedIndex, 1)
    nextOrder.splice(targetIndex, 0, item)
    navOrder.value = nextOrder
    void persistNavOrder(nextOrder)
  }

  return {
    loadUserPreferencesFromServer,
    navOrder,
    reorderNavSection,
    resetUserPreferences,
  }
}
