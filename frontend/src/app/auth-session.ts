import { computed, nextTick, ref } from 'vue'

import type { SessionUser } from '@/lib/api'
import { api } from '@/lib/api'
import type { useAppState } from '@/lib/app-state'

type BoardController = ReturnType<typeof useAppState>
type SidebarSessionApi = {
  loadSidebarStateFromServer: () => Promise<void>
  resetSidebarSyncState: () => void
}

type AuthSessionOptions = {
  alignTodayColumnToRight: () => void
  board: BoardController
  clearMessages: () => void
  ensureClientCacheOwner: (userId: string) => void
  sidebarSync: () => SidebarSessionApi
  setError: (message: string) => void
  setSuccess: (message: string) => void
}

export function useAuthSession(options: AuthSessionOptions) {
  const mode = ref<'login' | 'register'>('login')
  const loading = ref(true)
  const busy = ref(false)
  const user = ref<SessionUser | null>(null)
  const login = ref('')
  const password = ref('')
  const nickname = ref('')
  const email = ref('')
  const registerPassword = ref('')
  const planUsername = computed(() => user.value?.nickname ?? '')

  async function hydrateSession() {
    loading.value = true
    options.clearMessages()
    try {
      const result = await api.session()
      // Do not overwrite an already authenticated user with stale null from an in-flight request.
      if (result.user || !user.value) {
        user.value = result.user
      }
      if (user.value) {
        options.ensureClientCacheOwner(String(user.value.id))
        await options.board.load()
        options.board.startAutoSync()
        await options.sidebarSync().loadSidebarStateFromServer()
        await nextTick()
        options.alignTodayColumnToRight()
      }
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось проверить сессию')
    } finally {
      loading.value = false
    }
  }

  async function submitLogin() {
    busy.value = true
    options.clearMessages()
    try {
      const result = await api.login({
        login: login.value.trim(),
        password: password.value,
      })
      await options.board.load()
      user.value = result.user
      options.ensureClientCacheOwner(String(result.user.id))
      options.board.startAutoSync()
      await options.sidebarSync().loadSidebarStateFromServer()
      await nextTick()
      options.alignTodayColumnToRight()
      options.setSuccess('Вход выполнен')
      password.value = ''
    } catch (error) {
      user.value = null
      options.setError(error instanceof Error ? error.message : 'Не удалось выполнить вход')
    } finally {
      busy.value = false
    }
  }

  async function submitRegister() {
    busy.value = true
    options.clearMessages()
    try {
      const result = await api.register({
        nickname: nickname.value.trim(),
        email: email.value.trim(),
        password: registerPassword.value,
      })
      await options.board.load()
      user.value = result.user
      options.ensureClientCacheOwner(String(result.user.id))
      options.board.startAutoSync()
      await options.sidebarSync().loadSidebarStateFromServer()
      await nextTick()
      options.alignTodayColumnToRight()
      options.setSuccess('Аккаунт создан')
      registerPassword.value = ''
    } catch (error) {
      user.value = null
      options.setError(error instanceof Error ? error.message : 'Не удалось зарегистрироваться')
    } finally {
      busy.value = false
    }
  }

  async function handleLogout() {
    busy.value = true
    options.clearMessages()
    try {
      await api.logout()
      options.sidebarSync().resetSidebarSyncState()
      options.board.stopAutoSync()
      user.value = null
      login.value = ''
      password.value = ''
      options.setSuccess('Вы вышли из аккаунта')
    } catch (error) {
      options.setError(error instanceof Error ? error.message : 'Не удалось выйти')
    } finally {
      busy.value = false
    }
  }

  return {
    busy,
    email,
    handleLogout,
    hydrateSession,
    loading,
    login,
    mode,
    nickname,
    password,
    planUsername,
    registerPassword,
    submitLogin,
    submitRegister,
    user,
  }
}
