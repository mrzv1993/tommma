<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleX, Grip, ListPlus, LogOut, Menu, Plus, SquarePen, Trash2, X } from '@lucide/vue'

import type { SessionUser, SidebarState } from '@/lib/api'
import { api } from '@/lib/api'
import { useAppState, type DailyProjectEarning, type TaskItem } from '@/lib/app-state'
import {
  createDesktopTrayController,
  type DesktopTrayAction,
  type DesktopTrayController,
} from '@/lib/desktop-tray'

import AuthPanel from '@/components/auth/AuthPanel.vue'
import NotesBoard from '@/components/notes/NotesBoard.vue'
import sidebarIcon1 from '@/assets/sidebar-icon-1.png'
import sidebarIcon2 from '@/assets/sidebar-icon-2.png'

const mode = ref<'login' | 'register'>('login')
const loading = ref(true)
const busy = ref(false)
const errorText = ref('')
const successText = ref('')
const user = ref<SessionUser | null>(null)

const login = ref('')
const password = ref('')
const nickname = ref('')
const email = ref('')
const registerPassword = ref('')
const activeSection = ref<'board' | 'notes'>('board')
const sidebarOpen = ref(false)
const appNavCollapsed = ref(false)
const selectedProjectKey = ref('')
const projectSidebarWidth = ref(240)

const board = useAppState()
const selectedDateKey = board.selectedDateKey
const daysScrollRef = ref<HTMLElement | null>(null)
const slideDirection = ref<'left' | 'right'>('left')
const daysTransitionName = computed(() =>
  slideDirection.value === 'left' ? 'days-left' : 'days-right',
)

const nowMs = ref(Date.now())
const dailyDrafts = reactive<Record<string, string>>({})
const addTaskEditing = reactive<Record<string, boolean>>({})
const earningExpanded = reactive<Record<string, boolean>>({})
const financeTotalExpanded = reactive<Record<string, boolean>>({})
const editingEarningAmounts = reactive<Record<string, string>>({})
const skipEarningBlurSave = ref<string | null>(null)
const editingTaskTitles = reactive<Record<string, string>>({})
const skipTaskTitleBlurSave = ref<string | null>(null)
const taskRowClickTimers = new Map<string, number>()
let tickInterval: number | null = null
let sidebarSyncInterval: number | null = null
let sidebarSyncRetryTimeout: number | null = null
let sidebarSyncInFlight = false
let sidebarSyncPendingAfterFlight = false
let sidebarSyncDirty = false
let desktopTray: DesktopTrayController | null = null
let successMessageTimeout: number | null = null

function clearClientLocalCaches() {
  window.localStorage.removeItem(PROJECT_TASKS_STORAGE_KEY)
  window.localStorage.removeItem(PROJECT_STORIES_STORAGE_KEY)
  window.localStorage.removeItem(PROJECT_BOARDS_STORAGE_KEY)
  window.localStorage.removeItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY)
  window.localStorage.removeItem(NOTES_STORAGE_KEY)
  window.localStorage.removeItem(NOTES_SIDEBAR_WIDTH_STORAGE_KEY)
}

function ensureClientCacheOwner(userId: string) {
  const owner = window.localStorage.getItem(CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY)
  if (owner && owner !== userId) {
    clearClientLocalCaches()
  }
  window.localStorage.setItem(CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY, userId)
}

function setError(message: string) {
  errorText.value = message
  successText.value = ''
}

function setSuccess(message: string) {
  successText.value = message
  errorText.value = ''
  if (successMessageTimeout) {
    window.clearTimeout(successMessageTimeout)
  }
  successMessageTimeout = window.setTimeout(() => {
    successText.value = ''
    successMessageTimeout = null
  }, 3000)
}

function clearMessages() {
  if (successMessageTimeout) {
    window.clearTimeout(successMessageTimeout)
    successMessageTimeout = null
  }
  errorText.value = ''
  successText.value = ''
}

function parseDateKey(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}

function addYears(date: Date, years: number) {
  const next = new Date(date)
  next.setFullYear(next.getFullYear() + years)
  return next
}

function daysDiff(fromKey: string, toKey: string) {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / 86400000)
}

function formatDateLabel(dateKey: string) {
  return parseDateKey(dateKey).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

function formatFullDateLabel(dateKey: string) {
  const date = parseDateKey(dateKey)
  const dayMonth = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
  const year = date.toLocaleDateString('ru-RU', {
    year: 'numeric',
  })
  return `${dayMonth}, ${year}`
}

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

const tasksByDay = computed(() => {
  const map = new Map<string, TaskItem[]>()
  for (const day of weekDays.value) map.set(day.dateKey, [])

  for (const task of board.state.value.tasks) {
    if (task.column !== 'todo') continue
    if (!map.has(task.dateKey)) continue
    map.get(task.dateKey)?.push(task)
  }

  for (const list of map.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt)
  }

  return map
})

const progressByDay = computed(() => {
  const map = new Map<string, { total: number; done: number; percent: number }>()
  for (const day of weekDays.value) {
    const tasks = tasksByDay.value.get(day.dateKey) ?? []
    const total = tasks.length
    const done = tasks.filter((task) => task.completed).length
    map.set(day.dateKey, {
      total,
      done,
      percent: total ? Math.round((done / total) * 100) : 0,
    })
  }
  return map
})

const activeTimerTask = computed(() => {
  const activeTaskId = board.activeTimerTaskId.value
  if (!activeTaskId) return null
  return board.state.value.tasks.find((task) => task.id === activeTaskId) ?? null
})

const trayStateKey = computed(() => {
  const activeTask = activeTimerTask.value
  return [
    user.value?.id ?? 'guest',
    activeTask?.id ?? 'idle',
    activeTask?.title ?? '',
    activeTask?.actualSeconds ?? 0,
    activeTask?.sessionSeconds ?? 0,
    activeTask?.sessionStartedAt ?? 0,
    nowMs.value,
  ].join(':')
})

type DisplayEarning = DailyProjectEarning & {
  sourceEntryId: string | null
}

type ProjectTaskItem = {
  id: string
  title: string
  completed: boolean
  createdAt: number
}
type ProjectStoryItem = {
  key: string
  name: string
}
type SectionItem = {
  id: string
  boardId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}
type CardItem = {
  id: string
  sectionId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}
type ProjectBoardState = {
  sections: SectionItem[]
  cards: CardItem[]
}
const ROOT_SECTION_PREFIX = '__root__'

function rootSectionId(projectKey: string) {
  return `${ROOT_SECTION_PREFIX}:${projectKey}`
}

const REMOVED_PROJECT_NAMES = new Set(['новый проект'])
const EXPENSE_PROJECT_NAMES = new Set(['расход', 'расходы'])
const PROJECT_TASKS_STORAGE_KEY = 'tommma.projectTasks.v1'
const PROJECT_STORIES_STORAGE_KEY = 'tommma.projectStories.v1'
const PROJECT_BOARDS_STORAGE_KEY = 'tommma.projectBoards.v1'
const NOTES_STORAGE_KEY = 'tommma.notes.v1'
const NOTES_SIDEBAR_WIDTH_STORAGE_KEY = 'tommma.notes.sidebar.width.v1'
const CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY = 'tommma.cache.owner.user.v1'
const projectBoardsByProject = reactive<Record<string, ProjectBoardState>>({})
const sectionDraftByProject = reactive<Record<string, string>>({})
const cardDraftBySection = reactive<Record<string, string>>({})
const addSectionEditing = reactive<Record<string, boolean>>({})
const addCardEditing = reactive<Record<string, boolean>>({})
const sectionMenuOpenId = ref('')
const cardMenuOpenId = ref('')
const editingSectionId = ref('')
const editingSectionDraft = ref('')
const editingCardId = ref('')
const editingCardDraft = ref('')
const deleteSectionConfirmOpen = ref(false)
const pendingDeleteSectionId = ref('')
const projectStoriesState = ref<ProjectStoryItem[]>([])
const deleteProjectConfirmOpen = ref(false)
const renameProjectModalOpen = ref(false)
const renameProjectDraft = ref('')
const moveProjectModalOpen = ref(false)
const moveProjectDraft = ref<ProjectStoryItem[]>([])
const draggingProjectKey = ref('')
const draggingStoryKey = ref('')
const PROJECT_SIDEBAR_WIDTH_STORAGE_KEY = 'tommma.projectSidebar.width.v1'
const PROJECT_SIDEBAR_LEFT_OFFSET = 72
const PROJECT_SIDEBAR_LEFT_OFFSET_COLLAPSED = 16
const PROJECT_SIDEBAR_MIN_WIDTH = 220
const PROJECT_SIDEBAR_MAX_WIDTH = 520
let sidebarStateHydrating = false

function isRemovedProject(projectName: string) {
  return REMOVED_PROJECT_NAMES.has(normalizeProjectName(projectName))
}

function isExpenseProject(projectName: string) {
  return EXPENSE_PROJECT_NAMES.has(normalizeProjectName(projectName))
}

function signedProjectAmount(projectName: string, amount: number) {
  return isExpenseProject(projectName) ? -Math.abs(amount) : amount
}

const earningsByDay = computed(() => {
  const map = new Map<string, DisplayEarning[]>()
  const allEarningsByDate = board.getDailyEarningsMap()

  const projectMeta = new Map<string, { projectName: string; firstDateKey: string; firstTs: number }>()

  for (const [dateKey, rows] of Object.entries(allEarningsByDate)) {
    const ts = parseDateKey(dateKey).getTime()
    for (const row of rows) {
      const key = normalizeProjectName(row.projectName)
      if (!key || isRemovedProject(row.projectName)) continue
      const existing = projectMeta.get(key)
      if (!existing || ts < existing.firstTs) {
        projectMeta.set(key, {
          projectName: row.projectName,
          firstDateKey: dateKey,
          firstTs: ts,
        })
      }
    }
  }

  const sortedProjects = [...projectMeta.entries()].sort((a, b) => {
    const aExpense = isExpenseProject(a[1].projectName)
    const bExpense = isExpenseProject(b[1].projectName)
    if (aExpense !== bExpense) return aExpense ? 1 : -1
    return a[1].firstTs - b[1].firstTs
  })

  for (const day of weekDays.value) {
    const dayTs = parseDateKey(day.dateKey).getTime()
    const rows = board.getDayEarnings(day.dateKey)

    const byProject = rows.reduce(
      (acc, row) => {
        const key = normalizeProjectName(row.projectName)
        if (!key || isRemovedProject(row.projectName)) return acc
        if (!acc[key]) {
          acc[key] = {
            amount: 0,
            sourceEntryId: row.id,
          }
        }
        acc[key].amount += row.amount
        return acc
      },
      {} as Record<string, { amount: number; sourceEntryId: string | null }>,
    )

    const visible = sortedProjects
      .filter(([, meta]) => meta.firstTs <= dayTs)
      .map(([projectKey, meta]) => ({
        id: `${meta.firstDateKey}:${projectKey}`,
        projectName: meta.projectName,
        amount: byProject[projectKey]?.amount ?? 0,
        sourceEntryId: byProject[projectKey]?.sourceEntryId ?? null,
      }))

    map.set(day.dateKey, visible)
  }

  return map
})

const projectStories = computed(() =>
  projectStoriesState.value.map((story) => ({
    ...story,
    initials: projectLabelLetters(story.name),
  })),
)

const selectedProjectStory = computed(
  () => projectStoriesState.value.find((story) => story.key === selectedProjectKey.value) ?? null,
)

const selectedProjectBoard = computed(() => {
  const selected = selectedProjectKey.value
  if (!selected) return null
  return ensureProjectBoard(selected)
})

const selectedProjectSections = computed(() =>
  [...(selectedProjectBoard.value?.sections ?? [])].sort((a, b) => a.position - b.position),
)
const selectedProjectRootSectionId = computed(() =>
  selectedProjectKey.value ? rootSectionId(selectedProjectKey.value) : '',
)
const selectedProjectRootCards = computed(() => {
  const sectionId = selectedProjectRootSectionId.value
  if (!sectionId) return []
  return cardsForSection(sectionId)
})
const projectSidebarLeftPx = computed(() =>
  appNavCollapsed.value ? PROJECT_SIDEBAR_LEFT_OFFSET_COLLAPSED : PROJECT_SIDEBAR_LEFT_OFFSET,
)
const projectSidebarInlineStyle = computed(() => ({
  width: `${projectSidebarWidth.value}px`,
  left: `${projectSidebarLeftPx.value}px`,
}))
const boardOffsetPx = computed(() => projectSidebarLeftPx.value + projectSidebarWidth.value)
const boardInlineStyle = computed(() => ({ marginLeft: `${boardOffsetPx.value}px` }))
const notesInlineStyle = computed(() => ({ marginLeft: `${appNavCollapsed.value ? 16 : 88}px` }))

watch(
  projectStories,
  (stories) => {
    if (!stories.length) {
      selectedProjectKey.value = ''
      return
    }
    if (!stories.some((story) => story.key === selectedProjectKey.value)) {
      selectedProjectKey.value = stories[0].key
    }
  },
  { immediate: true },
)

async function hydrateSession() {
  loading.value = true
  clearMessages()
  try {
    const result = await api.session()
    // Do not overwrite an already authenticated user with stale null from an in-flight request.
    if (result.user || !user.value) {
      user.value = result.user
    }
    if (user.value) {
      ensureClientCacheOwner(String(user.value.id))
      await board.load()
      await loadSidebarStateFromServer()
      await nextTick()
      alignTodayColumnToRight()
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось проверить сессию')
  } finally {
    loading.value = false
  }
}

async function submitLogin() {
  busy.value = true
  clearMessages()
  try {
    const result = await api.login({
      login: login.value.trim(),
      password: password.value,
    })
    await board.load()
    user.value = result.user
    ensureClientCacheOwner(String(result.user.id))
    await loadSidebarStateFromServer()
    await nextTick()
    alignTodayColumnToRight()
    setSuccess('Вход выполнен')
    password.value = ''
  } catch (error) {
    user.value = null
    setError(error instanceof Error ? error.message : 'Не удалось выполнить вход')
  } finally {
    busy.value = false
  }
}

async function submitRegister() {
  busy.value = true
  clearMessages()
  try {
    const result = await api.register({
      nickname: nickname.value.trim(),
      email: email.value.trim(),
      password: registerPassword.value,
    })
    await board.load()
    user.value = result.user
    ensureClientCacheOwner(String(result.user.id))
    await loadSidebarStateFromServer()
    await nextTick()
    alignTodayColumnToRight()
    setSuccess('Аккаунт создан')
    registerPassword.value = ''
  } catch (error) {
    user.value = null
    setError(error instanceof Error ? error.message : 'Не удалось зарегистрироваться')
  } finally {
    busy.value = false
  }
}

async function handleLogout() {
  busy.value = true
  clearMessages()
  try {
    await api.logout()
    resetSidebarSyncState()
    user.value = null
    login.value = ''
    password.value = ''
    setSuccess('Вы вышли из аккаунта')
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось выйти')
  } finally {
    busy.value = false
  }
}

async function addTaskForDay(dateKey: string) {
  const draft = (dailyDrafts[dateKey] || '').trim()
  if (!draft) return
  // Clear draft immediately so saved text never appears in the next input state.
  dailyDrafts[dateKey] = ''
  try {
    await board.addTaskForDate(dateKey, 'todo', draft)
    addTaskEditing[dateKey] = true
    await nextTick()
    const input = document.querySelector<HTMLInputElement>(`input[data-add-input="${dateKey}"]`)
    if (input) {
      input.focus()
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось добавить задачу')
  }
}

async function startAddTaskEdit(dateKey: string) {
  addTaskEditing[dateKey] = true
  await nextTick()
  const input = document.querySelector<HTMLInputElement>(`input[data-add-input="${dateKey}"]`)
  input?.focus()
  input?.select()
}

function handleAddTaskBlur(dateKey: string) {
  if ((dailyDrafts[dateKey] || '').trim()) return
  addTaskEditing[dateKey] = false
}

function cancelAddTaskEdit(dateKey: string, event: KeyboardEvent) {
  dailyDrafts[dateKey] = ''
  addTaskEditing[dateKey] = false
  const target = event.target as HTMLInputElement | null
  target?.blur()
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`
}

function formatTrayDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function buildTraySnapshot() {
  if (!user.value) {
    return {
      title: 'Tommma',
      tooltip: 'Tommma: sign in to start timers',
    }
  }

  const activeTask = activeTimerTask.value
  if (!activeTask) {
    return {
      title: 'Tommma',
      tooltip: 'Tommma: no running timer',
    }
  }

  const elapsed = formatTrayDuration(board.getTaskElapsedSeconds(activeTask, nowMs.value))
  return {
    title: elapsed,
    tooltip: `${activeTask.title} · ${elapsed}`,
  }
}

function syncDesktopTray() {
  if (!desktopTray) return
  void desktopTray.setTimer(buildTraySnapshot()).catch(() => {})
}

function getNextTrayTimerTask() {
  const today = toDateKey(new Date())
  const todayTodo = board.state.value.tasks
    .filter((task) => task.dateKey === today && task.column === 'todo' && !task.completed)
    .sort((a, b) => a.createdAt - b.createdAt)

  if (todayTodo[0]) return todayTodo[0]

  return (
    board.state.value.tasks
      .filter((task) => task.dateKey === today && !task.completed)
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  )
}

async function selectTodayForTrayAction() {
  const today = toDateKey(new Date())
  if (selectedDateKey.value === today) return

  const diff = daysDiff(selectedDateKey.value, today)
  slideDirection.value = diff > 0 ? 'left' : 'right'
  await board.setToday()
  await nextTick()
  alignTodayColumnToRight()
}

async function handleTrayStartPause() {
  clearMessages()

  if (!user.value) {
    setError('Войдите в аккаунт, чтобы управлять таймером из status bar')
    return
  }

  const activeTask = activeTimerTask.value
  if (activeTask) {
    await board.pauseTimer(activeTask.id)
    return
  }

  const nextTask = getNextTrayTimerTask()
  if (!nextTask) {
    setError('На сегодня нет задач для запуска таймера')
    return
  }

  await selectTodayForTrayAction()
  await board.startTimer(nextTask.id)
}

async function handleTrayStop() {
  clearMessages()

  const activeTask = activeTimerTask.value
  if (!activeTask) return
  await board.stopTimer(activeTask.id)
}

async function handleDesktopTrayAction(action: DesktopTrayAction) {
  try {
    if (action === 'open') {
      if (user.value) {
        await selectTodayForTrayAction()
      }
      return
    }

    if (action === 'start-pause') {
      await handleTrayStartPause()
      return
    }

    if (action === 'stop') {
      await handleTrayStop()
      return
    }

    if (action === 'refresh' && user.value) {
      await board.load()
    }
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось выполнить действие status bar')
  } finally {
    syncDesktopTray()
  }
}

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

function parseAmount(raw: string) {
  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

function dayIncomeTotal(dateKey: string) {
  const rows = earningsByDay.value.get(dateKey) ?? []
  return rows.reduce((sum, row) => sum + signedProjectAmount(row.projectName, row.amount), 0)
}

function startOfCalendarWeek(date: Date) {
  const day = date.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  return addDays(date, diffToMonday)
}

function startOfCalendarMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfCalendarYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1)
}

function sumNetByRange(start: Date, end: Date) {
  const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  const allEarningsByDate = board.getDailyEarningsMap()
  let total = 0

  for (const [dateKey, rows] of Object.entries(allEarningsByDate)) {
    const ts = parseDateKey(dateKey).getTime()
    if (ts < startMs || ts > endMs) continue
    for (const row of rows) {
      total += signedProjectAmount(row.projectName, row.amount)
    }
  }

  return total
}

function periodNetByDate(dateKey: string, period: 'week' | 'month' | 'year') {
  const date = parseDateKey(dateKey)
  const start =
    period === 'week'
      ? startOfCalendarWeek(date)
      : period === 'month'
        ? startOfCalendarMonth(date)
        : startOfCalendarYear(date)
  const end = date
  return sumNetByRange(start, end)
}

function formatSignedMoney(value: number) {
  if (value > 0) return `+${formatMoney(value)}`
  if (value < 0) return `-${formatMoney(Math.abs(value))}`
  return formatMoney(0)
}

function toggleFinanceTotalExpanded(dateKey: string) {
  financeTotalExpanded[dateKey] = !financeTotalExpanded[dateKey]
}

function isFinanceTotalExpanded(dateKey: string) {
  return Boolean(financeTotalExpanded[dateKey])
}

function earningAmountEditKey(dateKey: string, earningId: string) {
  return `${dateKey}:${earningId}`
}

function displayProjectTitle(projectName: string) {
  const value = projectName.trim()
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function projectLabelLetters(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return 'P'
  const parts = trimmed.split(/\s+/).slice(0, 2)
  return parts
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('')
    .slice(0, 2)
}

async function addProjectStory() {
  const baseName = `Проект ${projectStoriesState.value.length + 1}`
  const story = {
    key: crypto.randomUUID(),
    name: baseName,
  } satisfies ProjectStoryItem
  projectStoriesState.value.push(story)
  selectedProjectKey.value = story.key
  saveProjectStories()
}

function openDeleteProjectConfirm() {
  if (!selectedProjectStory.value) return
  deleteProjectConfirmOpen.value = true
}

function cancelDeleteProjectConfirm() {
  deleteProjectConfirmOpen.value = false
}

function confirmDeleteProject() {
  const target = selectedProjectStory.value
  if (!target) return
  projectStoriesState.value = projectStoriesState.value.filter((story) => story.key !== target.key)
  delete projectBoardsByProject[target.key]
  saveProjectStories()
  saveProjectBoards()
  deleteProjectConfirmOpen.value = false
}

function openRenameProjectModal() {
  const target = selectedProjectStory.value
  if (!target) return
  renameProjectDraft.value = target.name
  renameProjectModalOpen.value = true
}

function closeRenameProjectModal() {
  renameProjectModalOpen.value = false
}

function submitRenameProject() {
  const target = selectedProjectStory.value
  if (!target) return
  const nextName = renameProjectDraft.value.trim()
  if (!nextName) return
  const story = projectStoriesState.value.find((item) => item.key === target.key)
  if (!story) return
  story.name = nextName
  saveProjectStories()
  renameProjectModalOpen.value = false
}

function openMoveProjectModal() {
  moveProjectDraft.value = projectStoriesState.value.map((story) => ({ ...story }))
  moveProjectModalOpen.value = true
}

function closeMoveProjectModal() {
  moveProjectModalOpen.value = false
}

function handleStoryDragStart(projectKey: string) {
  draggingStoryKey.value = projectKey
}

function handleStoryDragEnd() {
  draggingStoryKey.value = ''
}

function handleStoryDragOver(event: DragEvent, targetKey: string) {
  event.preventDefault()
  const draggedKey = draggingStoryKey.value
  if (!draggedKey || draggedKey === targetKey) return
  const targetIndex = projectStoriesState.value.findIndex((item) => item.key === targetKey)
  const draggedIndex = projectStoriesState.value.findIndex((item) => item.key === draggedKey)
  if (targetIndex === -1 || draggedIndex === -1) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const before = event.clientX < rect.left + rect.width / 2
  const [dragged] = projectStoriesState.value.splice(draggedIndex, 1)
  const insertIndex = before ? targetIndex : targetIndex + 1
  projectStoriesState.value.splice(insertIndex, 0, dragged)
  saveProjectStories()
}

function loadProjectSidebarWidth() {
  const raw = window.localStorage.getItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY)
  const width = Number(raw)
  if (!Number.isFinite(width)) return
  projectSidebarWidth.value = Math.max(PROJECT_SIDEBAR_MIN_WIDTH, Math.min(PROJECT_SIDEBAR_MAX_WIDTH, width))
}

function saveProjectSidebarWidth() {
  window.localStorage.setItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY, String(projectSidebarWidth.value))
  markSidebarStateDirty()
}

function startSidebarResize(event: MouseEvent) {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = projectSidebarWidth.value

  const handleMouseMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX
    const next = startWidth + delta
    projectSidebarWidth.value = Math.max(PROJECT_SIDEBAR_MIN_WIDTH, Math.min(PROJECT_SIDEBAR_MAX_WIDTH, next))
  }

  const handleMouseUp = () => {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
    saveProjectSidebarWidth()
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMoveDragStart(projectKey: string) {
  draggingProjectKey.value = projectKey
}

function handleMoveDragEnd() {
  draggingProjectKey.value = ''
}

function handleMoveDragOver(event: DragEvent, targetKey: string) {
  event.preventDefault()
  const draggedKey = draggingProjectKey.value
  if (!draggedKey || draggedKey === targetKey) return
  const targetIndex = moveProjectDraft.value.findIndex((item) => item.key === targetKey)
  const draggedIndex = moveProjectDraft.value.findIndex((item) => item.key === draggedKey)
  if (targetIndex === -1 || draggedIndex === -1) return

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const before = event.clientY < rect.top + rect.height / 2
  const [dragged] = moveProjectDraft.value.splice(draggedIndex, 1)
  const insertIndex = before ? targetIndex : targetIndex + 1
  moveProjectDraft.value.splice(insertIndex, 0, dragged)
}

function saveProjectOrder() {
  projectStoriesState.value = moveProjectDraft.value.map((story) => ({ ...story }))
  saveProjectStories()
  moveProjectModalOpen.value = false
}

function ensureProjectBoard(projectKey: string): ProjectBoardState {
  if (!projectBoardsByProject[projectKey]) {
    projectBoardsByProject[projectKey] = {
      sections: [],
      cards: [],
    }
  }
  return projectBoardsByProject[projectKey]
}

function saveProjectBoards() {
  window.localStorage.setItem(PROJECT_BOARDS_STORAGE_KEY, JSON.stringify(projectBoardsByProject))
  markSidebarStateDirty()
}

function cardsForSection(sectionId: string) {
  const board = selectedProjectBoard.value
  if (!board) return []
  return board.cards.filter((card) => card.sectionId === sectionId).sort((a, b) => a.position - b.position)
}

function addSection() {
  const projectKey = selectedProjectKey.value
  if (!projectKey) return
  const title = (sectionDraftByProject[projectKey] || '').trim()
  if (!title) return
  const board = ensureProjectBoard(projectKey)
  const now = new Date().toISOString()
  board.sections.push({
    id: crypto.randomUUID(),
    boardId: projectKey,
    title,
    position: board.sections.length,
    createdAt: now,
    updatedAt: now,
  })
  sectionDraftByProject[projectKey] = ''
  addSectionEditing[projectKey] = true
  saveProjectBoards()
  void nextTick().then(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-add-section-input="${projectKey}"]`)
    input?.focus()
  })
}

function startAddSectionEdit() {
  const projectKey = selectedProjectKey.value
  if (!projectKey) return
  addSectionEditing[projectKey] = true
  void nextTick().then(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-add-section-input="${projectKey}"]`)
    input?.focus()
  })
}

function handleAddSectionBlur(projectKey: string) {
  if ((sectionDraftByProject[projectKey] || '').trim()) return
  addSectionEditing[projectKey] = false
}

function cancelAddSectionEdit(projectKey: string, event: KeyboardEvent) {
  sectionDraftByProject[projectKey] = ''
  addSectionEditing[projectKey] = false
  const target = event.target as HTMLInputElement | null
  target?.blur()
}

function startSectionRename(section: SectionItem) {
  editingSectionId.value = section.id
  editingSectionDraft.value = section.title
  sectionMenuOpenId.value = ''
}

function startSectionRenameByDoubleClick(section: SectionItem) {
  startSectionRename(section)
}

function submitSectionRename() {
  const board = selectedProjectBoard.value
  if (!board || !editingSectionId.value) return
  const title = editingSectionDraft.value.trim()
  if (!title) return
  const target = board.sections.find((item) => item.id === editingSectionId.value)
  if (!target) return
  target.title = title
  target.updatedAt = new Date().toISOString()
  editingSectionId.value = ''
  editingSectionDraft.value = ''
  saveProjectBoards()
}

function openDeleteSectionConfirm(sectionId: string) {
  pendingDeleteSectionId.value = sectionId
  deleteSectionConfirmOpen.value = true
  sectionMenuOpenId.value = ''
}

function cancelDeleteSectionConfirm() {
  deleteSectionConfirmOpen.value = false
  pendingDeleteSectionId.value = ''
}

function confirmDeleteSection() {
  const board = selectedProjectBoard.value
  if (!board || !pendingDeleteSectionId.value) return
  const sectionId = pendingDeleteSectionId.value
  board.sections = board.sections
    .filter((section) => section.id !== sectionId)
    .map((section, index) => ({ ...section, position: index }))
  board.cards = board.cards.filter((card) => card.sectionId !== sectionId)
  deleteSectionConfirmOpen.value = false
  pendingDeleteSectionId.value = ''
  saveProjectBoards()
}

function addCard(sectionId: string) {
  const board = selectedProjectBoard.value
  if (!board) return
  const title = (cardDraftBySection[sectionId] || '').trim()
  if (!title) return
  const now = new Date().toISOString()
  const cardsInSection = board.cards.filter((card) => card.sectionId === sectionId)
  board.cards.push({
    id: crypto.randomUUID(),
    sectionId,
    title,
    position: cardsInSection.length,
    createdAt: now,
    updatedAt: now,
  })
  cardDraftBySection[sectionId] = ''
  addCardEditing[sectionId] = true
  saveProjectBoards()
  void nextTick().then(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-add-card-input="${sectionId}"]`)
    input?.focus()
  })
}

function startAddCardEdit(sectionId: string) {
  addCardEditing[sectionId] = true
  void nextTick().then(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-add-card-input="${sectionId}"]`)
    input?.focus()
  })
}

function addProjectCard() {
  const sectionId = selectedProjectRootSectionId.value
  if (!sectionId) return
  addCard(sectionId)
}

function startAddProjectCardEdit() {
  const sectionId = selectedProjectRootSectionId.value
  if (!sectionId) return
  startAddCardEdit(sectionId)
}

function handleAddProjectCardBlur() {
  const sectionId = selectedProjectRootSectionId.value
  if (!sectionId) return
  handleAddCardBlur(sectionId)
}

function cancelAddProjectCardEdit(event: KeyboardEvent) {
  const sectionId = selectedProjectRootSectionId.value
  if (!sectionId) return
  cancelAddCardEdit(sectionId, event)
}

function handleAddCardBlur(sectionId: string) {
  if ((cardDraftBySection[sectionId] || '').trim()) return
  addCardEditing[sectionId] = false
}

function cancelAddCardEdit(sectionId: string, event: KeyboardEvent) {
  cardDraftBySection[sectionId] = ''
  addCardEditing[sectionId] = false
  const target = event.target as HTMLInputElement | null
  target?.blur()
}

function startCardRename(card: CardItem) {
  editingCardId.value = card.id
  editingCardDraft.value = card.title
  cardMenuOpenId.value = ''
}

function startCardRenameByDoubleClick(card: CardItem) {
  startCardRename(card)
}

function submitCardRename() {
  const board = selectedProjectBoard.value
  if (!board || !editingCardId.value) return
  const title = editingCardDraft.value.trim()
  if (!title) return
  const target = board.cards.find((item) => item.id === editingCardId.value)
  if (!target) return
  target.title = title
  target.updatedAt = new Date().toISOString()
  editingCardId.value = ''
  editingCardDraft.value = ''
  saveProjectBoards()
}

function deleteCard(cardId: string) {
  const board = selectedProjectBoard.value
  if (!board) return
  const target = board.cards.find((card) => card.id === cardId)
  if (!target) return
  board.cards = board.cards.filter((card) => card.id !== cardId)
  const updated = board.cards
    .filter((card) => card.sectionId === target.sectionId)
    .sort((a, b) => a.position - b.position)
  updated.forEach((card, index) => {
    card.position = index
  })
  cardMenuOpenId.value = ''
  saveProjectBoards()
}

const draggingCardId = ref('')

function handleCardDragStart(cardId: string) {
  draggingCardId.value = cardId
}

function handleCardDragEnd() {
  draggingCardId.value = ''
}

function normalizeSectionCardPositions(board: ProjectBoardState, sectionId: string) {
  const list = board.cards.filter((card) => card.sectionId === sectionId).sort((a, b) => a.position - b.position)
  list.forEach((card, index) => {
    card.position = index
  })
}

function handleCardDragOver(event: DragEvent, sectionId: string, targetCardId: string | null = null) {
  event.preventDefault()
  const board = selectedProjectBoard.value
  const draggedCardId = draggingCardId.value
  if (!board || !draggedCardId) return
  const dragged = board.cards.find((card) => card.id === draggedCardId)
  if (!dragged) return
  const fromSectionId = dragged.sectionId

  if (!targetCardId) {
    dragged.sectionId = sectionId
    const lastPosition = Math.max(
      -1,
      ...board.cards.filter((card) => card.sectionId === sectionId && card.id !== dragged.id).map((card) => card.position),
    )
    dragged.position = lastPosition + 1
    normalizeSectionCardPositions(board, sectionId)
    if (fromSectionId !== sectionId) normalizeSectionCardPositions(board, fromSectionId)
    saveProjectBoards()
    return
  }

  const target = board.cards.find((card) => card.id === targetCardId)
  if (!target || target.id === dragged.id) return
  const toSectionId = target.sectionId

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const before = event.clientY < rect.top + rect.height / 2

  const targetSectionCards = board.cards
    .filter((card) => card.sectionId === toSectionId && card.id !== dragged.id)
    .sort((a, b) => a.position - b.position)
  const targetIndex = targetSectionCards.findIndex((card) => card.id === target.id)
  const insertIndex = before ? targetIndex : targetIndex + 1

  dragged.sectionId = toSectionId
  targetSectionCards.splice(insertIndex, 0, dragged)
  targetSectionCards.forEach((card, index) => {
    card.position = index
  })
  normalizeSectionCardPositions(board, fromSectionId)
  saveProjectBoards()
}

function isEarningAmountEditing(dateKey: string, earningId: string) {
  const key = earningAmountEditKey(dateKey, earningId)
  return typeof editingEarningAmounts[key] === 'string'
}

async function setDailyProjectAmount(dateKey: string, earning: DisplayEarning, amount: number) {
  if (earning.sourceEntryId) {
    await board.updateDailyEarningForDate(dateKey, earning.sourceEntryId, { amount })
    return
  }

  const fallback = board
    .getDayEarnings(dateKey)
    .find((item) => normalizeProjectName(item.projectName) === normalizeProjectName(earning.projectName))

  if (fallback) {
    await board.updateDailyEarningForDate(dateKey, fallback.id, { amount })
    return
  }

  await board.addDailyEarningForDate(dateKey, earning.projectName, amount)
}

function startEarningAmountEdit(dateKey: string, earning: DisplayEarning) {
  const key = earningAmountEditKey(dateKey, earning.id)
  editingEarningAmounts[key] = String(Math.round(earning.amount))
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-earning-edit="${key}"]`)
    input?.focus()
    input?.select()
  })
}

function cancelEarningAmountEdit(dateKey: string, earningId: string) {
  const key = earningAmountEditKey(dateKey, earningId)
  delete editingEarningAmounts[key]
}

async function saveEarningAmountEdit(dateKey: string, earning: DisplayEarning) {
  const key = earningAmountEditKey(dateKey, earning.id)
  const rawAmount = editingEarningAmounts[key] ?? String(earning.amount)
  const nextAmount = parseAmount(rawAmount)
  delete editingEarningAmounts[key]
  try {
    await setDailyProjectAmount(dateKey, earning, nextAmount)
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось обновить сумму проекта')
  }
}

async function handleEarningAmountBlur(dateKey: string, earning: DisplayEarning) {
  const key = earningAmountEditKey(dateKey, earning.id)
  if (skipEarningBlurSave.value === key) {
    skipEarningBlurSave.value = null
    return
  }
  await saveEarningAmountEdit(dateKey, earning)
}

async function handleEarningAmountEnter(dateKey: string, earning: DisplayEarning, event: KeyboardEvent) {
  const key = earningAmountEditKey(dateKey, earning.id)
  skipEarningBlurSave.value = key
  await saveEarningAmountEdit(dateKey, earning)
  const target = event.target as HTMLInputElement | null
  target?.blur()
}

function handleEarningAmountEscape(dateKey: string, earning: DisplayEarning, event: KeyboardEvent) {
  const key = earningAmountEditKey(dateKey, earning.id)
  skipEarningBlurSave.value = key
  cancelEarningAmountEdit(dateKey, earning.id)
  const target = event.target as HTMLInputElement | null
  target?.blur()
}


async function toggleTask(taskId: string) {
  try {
    await board.toggleTask(taskId)
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось обновить задачу')
  }
}

function clearTaskRowClickTimer(taskId: string) {
  const timer = taskRowClickTimers.get(taskId)
  if (!timer) return
  window.clearTimeout(timer)
  taskRowClickTimers.delete(taskId)
}

function isTaskTitleEditing(taskId: string) {
  return typeof editingTaskTitles[taskId] === 'string'
}

function handleTaskRowClick(taskId: string) {
  if (isTaskTitleEditing(taskId)) return
  clearTaskRowClickTimer(taskId)
  const timer = window.setTimeout(() => {
    taskRowClickTimers.delete(taskId)
    void toggleTask(taskId)
  }, 220)
  taskRowClickTimers.set(taskId, timer)
}

function startTaskTitleEdit(task: TaskItem) {
  clearTaskRowClickTimer(task.id)
  editingTaskTitles[task.id] = task.title
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-task-edit="${task.id}"]`)
    input?.focus()
    input?.select()
  })
}

function cancelTaskTitleEdit(taskId: string) {
  delete editingTaskTitles[taskId]
}

async function saveTaskTitleEdit(taskId: string) {
  const nextTitle = editingTaskTitles[taskId]
  if (typeof nextTitle !== 'string') return
  delete editingTaskTitles[taskId]
  try {
    await board.updateTaskTitle(taskId, nextTitle)
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось обновить задачу')
  }
}

async function handleTaskTitleBlur(taskId: string) {
  if (skipTaskTitleBlurSave.value === taskId) {
    skipTaskTitleBlurSave.value = null
    return
  }
  await saveTaskTitleEdit(taskId)
}

async function handleTaskTitleEnter(taskId: string, event: KeyboardEvent) {
  skipTaskTitleBlurSave.value = taskId
  await saveTaskTitleEdit(taskId)
  const target = event.target as HTMLInputElement | null
  target?.blur()
}

function handleTaskTitleEscape(taskId: string, event: KeyboardEvent) {
  skipTaskTitleBlurSave.value = taskId
  cancelTaskTitleEdit(taskId)
  const target = event.target as HTMLInputElement | null
  target?.blur()
}

async function removeTaskById(taskId: string) {
  clearTaskRowClickTimer(taskId)
  cancelTaskTitleEdit(taskId)
  try {
    await board.removeTask(taskId)
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось удалить задачу')
  }
}

function scoreTarget(task: TaskItem) {
  const lower = task.title.toLowerCase()
  if (lower.includes('заработ')) return 240
  if (lower.includes('молит')) return 20
  if (lower.includes('размин')) return 20
  if (lower.includes('чтени')) return 20
  const match = task.title.match(/\/\s*(\d{1,4})$/)
  if (match) return Number(match[1])
  return null
}

function scoreLabel(task: TaskItem) {
  const target = scoreTarget(task)
  if (!target) return null
  const elapsedMinutes = Math.floor(board.getTaskElapsedSeconds(task, nowMs.value) / 60)
  const fact = elapsedMinutes > 0 ? elapsedMinutes : task.completed ? target : 0
  return `${Math.min(fact, target)} / ${target}`
}

function dayPercent(dateKey: string) {
  return progressByDay.value.get(dateKey)?.percent ?? 0
}

function earningAccordionKey(dateKey: string, earningId: string) {
  return `${dateKey}:${earningId}`
}

function toggleEarningExpanded(dateKey: string, earningId: string) {
  const key = earningAccordionKey(dateKey, earningId)
  cancelEarningAmountEdit(dateKey, earningId)
  earningExpanded[key] = !earningExpanded[key]
}

function isEarningExpanded(dateKey: string, earningId: string) {
  return Boolean(earningExpanded[earningAccordionKey(dateKey, earningId)])
}

function normalizeProjectName(projectName: string) {
  return projectName.trim().toLowerCase()
}

function incomeByProjectOnDate(dateKey: string, projectName: string) {
  const key = normalizeProjectName(projectName)
  if (!key || REMOVED_PROJECT_NAMES.has(key)) return 0
  const amount = board
    .getDayEarnings(dateKey)
    .filter((item) => normalizeProjectName(item.projectName) === key && !isRemovedProject(item.projectName))
    .reduce((sum, item) => sum + item.amount, 0)
  return signedProjectAmount(projectName, amount)
}

function deltaByPeriod(dateKey: string, projectName: string, period: 'yesterday' | 'week' | 'month' | 'year') {
  const current = incomeByProjectOnDate(dateKey, projectName)
  const previous = previousByPeriod(dateKey, projectName, period)
  return current - previous
}

function previousByPeriod(dateKey: string, projectName: string, period: 'yesterday' | 'week' | 'month' | 'year') {
  const sourceDate = parseDateKey(dateKey)
  const compareDate =
    period === 'yesterday'
      ? addDays(sourceDate, -1)
      : period === 'week'
        ? addDays(sourceDate, -7)
        : period === 'month'
          ? addMonths(sourceDate, -1)
          : addYears(sourceDate, -1)
  return incomeByProjectOnDate(toDateKey(compareDate), projectName)
}

function deltaPercentByPeriod(dateKey: string, projectName: string, period: 'yesterday' | 'week' | 'month' | 'year') {
  const current = incomeByProjectOnDate(dateKey, projectName)
  const previous = previousByPeriod(dateKey, projectName, period)
  const delta = current - previous

  if (previous === 0) {
    if (delta > 0) return 100
    if (delta < 0) return -100
    return 0
  }

  return Math.round((delta / previous) * 100)
}


function formatPercent(value: number) {
  return `${Math.abs(value)}%`
}

function formatDelta(value: number) {
  if (value > 0) return `+${formatMoney(value)}`
  if (value < 0) return `-${formatMoney(Math.abs(value))}`
  return formatMoney(0)
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

function collectStoriesFromEarnings() {
  const allEarningsByDate = board.getDailyEarningsMap()
  const projectMeta = new Map<string, { projectName: string; firstTs: number }>()
  for (const [dateKey, rows] of Object.entries(allEarningsByDate)) {
    const ts = parseDateKey(dateKey).getTime()
    for (const row of rows) {
      const normalized = normalizeProjectName(row.projectName)
      if (!normalized || isRemovedProject(row.projectName)) continue
      const existing = projectMeta.get(normalized)
      if (!existing || ts < existing.firstTs) {
        projectMeta.set(normalized, { projectName: row.projectName, firstTs: ts })
      }
    }
  }
  return [...projectMeta.entries()]
    .sort((a, b) => a[1].firstTs - b[1].firstTs)
    .map(([, meta]) => ({
      key: crypto.randomUUID(),
      name: displayProjectTitle(meta.projectName),
    })) satisfies ProjectStoryItem[]
}

function loadProjectStories() {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(window.localStorage.getItem(PROJECT_STORIES_STORAGE_KEY) || '[]')
  } catch {
    parsed = []
  }
  if (Array.isArray(parsed)) {
    const restored = parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const item = entry as Partial<ProjectStoryItem>
        if (typeof item.key !== 'string' || typeof item.name !== 'string') return null
        const name = item.name.trim()
        if (!name) return null
        return { key: item.key, name } satisfies ProjectStoryItem
      })
      .filter((item): item is ProjectStoryItem => item !== null)
    if (restored.length) {
      projectStoriesState.value = restored
      return
    }
  }
  projectStoriesState.value = collectStoriesFromEarnings()
  saveProjectStories()
}

function saveProjectStories() {
  window.localStorage.setItem(PROJECT_STORIES_STORAGE_KEY, JSON.stringify(projectStoriesState.value))
  markSidebarStateDirty()
}

function buildSidebarStatePayload(): SidebarState {
  return {
    stories: projectStoriesState.value.map((story) => ({ key: story.key, name: story.name })),
    boards: JSON.parse(JSON.stringify(projectBoardsByProject)) as SidebarState['boards'],
    sidebarWidth: projectSidebarWidth.value,
  }
}

function isSidebarStateEffectivelyEmpty(state: SidebarState) {
  return state.stories.length === 0 && Object.keys(state.boards || {}).length === 0
}

function hasLocalSidebarData() {
  return projectStoriesState.value.length > 0 || Object.keys(projectBoardsByProject).length > 0
}

function applySidebarState(state: SidebarState) {
  sidebarStateHydrating = true
  try {
    projectStoriesState.value = state.stories.map((story) => ({ key: story.key, name: story.name }))
    for (const key of Object.keys(projectBoardsByProject)) {
      delete projectBoardsByProject[key]
    }
    for (const [projectKey, boardState] of Object.entries(state.boards)) {
      projectBoardsByProject[projectKey] = {
        sections: boardState.sections.map((section) => ({ ...section })),
        cards: boardState.cards.map((card) => ({ ...card })),
      }
    }
    projectSidebarWidth.value = Math.max(
      PROJECT_SIDEBAR_MIN_WIDTH,
      Math.min(PROJECT_SIDEBAR_MAX_WIDTH, state.sidebarWidth),
    )
  } finally {
    sidebarStateHydrating = false
  }
}

function persistSidebarStateToLocalCache() {
  window.localStorage.setItem(PROJECT_STORIES_STORAGE_KEY, JSON.stringify(projectStoriesState.value))
  window.localStorage.setItem(PROJECT_BOARDS_STORAGE_KEY, JSON.stringify(projectBoardsByProject))
  window.localStorage.setItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY, String(projectSidebarWidth.value))
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
  if (!user.value) return
  sidebarSyncDirty = true
  scheduleSidebarStateSync(250)
}

function resetSidebarSyncState() {
  sidebarSyncDirty = false
  sidebarSyncInFlight = false
  sidebarSyncPendingAfterFlight = false
  if (sidebarSyncRetryTimeout) {
    window.clearTimeout(sidebarSyncRetryTimeout)
    sidebarSyncRetryTimeout = null
  }
}

async function syncSidebarState() {
  if (!user.value) return
  if (sidebarStateHydrating) return
  if (sidebarSyncInFlight) {
    sidebarSyncPendingAfterFlight = true
    return
  }

  sidebarSyncInFlight = true
  try {
    if (sidebarSyncDirty) {
      const result = await api.putSidebarState(buildSidebarStatePayload())
      applySidebarState(result.sidebar)
      persistSidebarStateToLocalCache()
      sidebarSyncDirty = false
    } else {
      const result = await api.getSidebarState()
      if (isSidebarStateEffectivelyEmpty(result.sidebar) && hasLocalSidebarData()) {
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
  if (!user.value) return
  try {
    const result = await api.getSidebarState()
    if (!isSidebarStateEffectivelyEmpty(result.sidebar)) {
      applySidebarState(result.sidebar)
      persistSidebarStateToLocalCache()
      sidebarSyncDirty = false
      return
    }
  } catch {
    // If server is temporarily unreachable, keep local snapshot and retry in background.
    scheduleSidebarStateSync(2000)
  }

  loadProjectStories()
  loadProjectBoards()
  loadProjectSidebarWidth()

  const hasLocalData = hasLocalSidebarData()

  if (!projectStoriesState.value.length) {
    projectStoriesState.value = collectStoriesFromEarnings()
    saveProjectStories()
    return
  }

  if (hasLocalData) {
    markSidebarStateDirty()
  }
}

function syncSidebarOnForeground() {
  if (!user.value) return
  if (document.visibilityState === 'hidden') return
  void syncSidebarState()
}

function startSidebarAutoSync() {
  if (sidebarSyncInterval) return
  sidebarSyncInterval = window.setInterval(() => {
    if (!user.value) return
    void syncSidebarState()
  }, 10000)
}

function stopSidebarAutoSync() {
  if (!sidebarSyncInterval) return
  window.clearInterval(sidebarSyncInterval)
  sidebarSyncInterval = null
}

function loadProjectBoards() {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(window.localStorage.getItem(PROJECT_BOARDS_STORAGE_KEY) || '{}')
  } catch {
    parsed = {}
  }

  for (const key of Object.keys(projectBoardsByProject)) {
    delete projectBoardsByProject[key]
  }

  if (!parsed || typeof parsed !== 'object') return
  const source = parsed as Record<string, unknown>
  for (const [projectKey, rawBoard] of Object.entries(source)) {
    if (!rawBoard || typeof rawBoard !== 'object') continue
    const board = rawBoard as { sections?: unknown; cards?: unknown }
    const sections = Array.isArray(board.sections)
      ? board.sections
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const item = entry as Partial<SectionItem>
            if (typeof item.id !== 'string' || typeof item.boardId !== 'string' || typeof item.title !== 'string') return null
            return {
              id: item.id,
              boardId: item.boardId,
              title: item.title,
              position: Number(item.position ?? 0),
              createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
              updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
            } satisfies SectionItem
          })
          .filter((item): item is SectionItem => item !== null)
      : []
    const sectionIds = new Set(sections.map((section) => section.id))
    const rootSection = rootSectionId(projectKey)
    const cards = Array.isArray(board.cards)
      ? board.cards
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null
            const item = entry as Partial<CardItem>
            if (typeof item.id !== 'string' || typeof item.sectionId !== 'string' || typeof item.title !== 'string') return null
            if (!sectionIds.has(item.sectionId) && item.sectionId !== rootSection) return null
            return {
              id: item.id,
              sectionId: item.sectionId,
              title: item.title,
              position: Number(item.position ?? 0),
              createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
              updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
            } satisfies CardItem
          })
          .filter((item): item is CardItem => item !== null)
      : []
    projectBoardsByProject[projectKey] = { sections, cards }
  }

  if (!Object.keys(projectBoardsByProject).length) {
    // Backward compatibility with the previous project tasks storage.
    try {
      const legacyParsed = JSON.parse(window.localStorage.getItem(PROJECT_TASKS_STORAGE_KEY) || '{}') as Record<
        string,
        ProjectTaskItem[]
      >
      for (const [projectKey, tasks] of Object.entries(legacyParsed)) {
        if (!Array.isArray(tasks) || !tasks.length) continue
        const sectionId = crypto.randomUUID()
        const now = new Date().toISOString()
        projectBoardsByProject[projectKey] = {
          sections: [
            {
              id: sectionId,
              boardId: projectKey,
              title: 'Раздел 1',
              position: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
          cards: tasks.map((task, index) => ({
            id: task.id || crypto.randomUUID(),
            sectionId,
            title: task.title,
            position: index,
            createdAt: new Date(task.createdAt || Date.now()).toISOString(),
            updatedAt: now,
          })),
        }
      }
      saveProjectBoards()
    } catch {
      // ignore migration errors
    }
  }
}

onMounted(() => {
  tickInterval = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  void createDesktopTrayController({
    onAction: handleDesktopTrayAction,
  })
    .then((controller) => {
      desktopTray = controller
      syncDesktopTray()
    })
    .catch(() => {})
  void hydrateSession()
  startSidebarAutoSync()
  window.addEventListener('focus', syncSidebarOnForeground)
  document.addEventListener('visibilitychange', syncSidebarOnForeground)
})

watch(trayStateKey, () => {
  syncDesktopTray()
})

onBeforeUnmount(() => {
  if (tickInterval) {
    window.clearInterval(tickInterval)
    tickInterval = null
  }
  stopSidebarAutoSync()
  window.removeEventListener('focus', syncSidebarOnForeground)
  document.removeEventListener('visibilitychange', syncSidebarOnForeground)
  for (const timer of taskRowClickTimers.values()) {
    window.clearTimeout(timer)
  }
  taskRowClickTimers.clear()
  desktopTray?.destroy()
  desktopTray = null
  if (successMessageTimeout) {
    window.clearTimeout(successMessageTimeout)
    successMessageTimeout = null
  }
  resetSidebarSyncState()
})
</script>

<template>
  <main class="screen">
    <AuthPanel
      v-if="!user"
      :mode="mode"
      :busy="busy"
      :login="login"
      :password="password"
      :nickname="nickname"
      :email="email"
      :register-password="registerPassword"
      :error-text="errorText"
      :success-text="successText"
      @update:mode="mode = $event"
      @update:login="login = $event"
      @update:password="password = $event"
      @update:nickname="nickname = $event"
      @update:email="email = $event"
      @update:register-password="registerPassword = $event"
      @submit-login="submitLogin"
      @submit-register="submitRegister"
    />

    <template v-else>
      <button class="mobile-nav-toggle" @click="sidebarOpen = !sidebarOpen">
        <Menu v-if="!sidebarOpen" :size="18" />
        <X v-else :size="18" />
      </button>
      <aside class="app-sidebar" :class="{ open: sidebarOpen, collapsed: appNavCollapsed }">
        <button
          class="section-icon"
          :class="{ active: activeSection === 'board' }"
          @click="activeSection = 'board'; sidebarOpen = false"
          title="Текущий раздел"
        >
          <img class="section-icon-img" :src="sidebarIcon1" alt="" />
        </button>
        <button
          class="section-icon"
          :class="{ active: activeSection === 'notes' }"
          @click="activeSection = 'notes'; sidebarOpen = false"
          title="Заметки"
        >
          <img class="section-icon-img" :src="sidebarIcon2" alt="" />
        </button>
        <div class="app-sidebar-spacer" />
        <button class="sidebar-logout" :disabled="busy" aria-label="Выйти" title="Выйти" @click="handleLogout">
          <LogOut class="logout-icon" />
        </button>
      </aside>
      <button
        class="app-sidebar-toggle"
        :class="{ collapsed: appNavCollapsed }"
        type="button"
        :aria-label="appNavCollapsed ? 'Раскрыть навигацию' : 'Скрыть навигацию'"
        :title="appNavCollapsed ? 'Раскрыть навигацию' : 'Скрыть навигацию'"
        @click="appNavCollapsed = !appNavCollapsed"
      >
        <ChevronRight v-if="appNavCollapsed" :size="16" />
        <ChevronLeft v-else :size="16" />
      </button>

      <aside v-if="activeSection === 'board'" class="project-sidebar" :style="projectSidebarInlineStyle">
        <div class="project-stories">
          <button
            v-for="story in projectStories"
            :key="story.key"
            class="project-story"
            :class="{ active: selectedProjectKey === story.key }"
            type="button"
            draggable="true"
            @click="selectedProjectKey = story.key"
            @dragstart="handleStoryDragStart(story.key)"
            @dragend="handleStoryDragEnd"
            @dragover="handleStoryDragOver($event, story.key)"
          >
            <span class="project-story-avatar">{{ story.initials }}</span>
            <span class="project-story-name">{{ story.name }}</span>
          </button>
          <button
            class="project-story project-story-add"
            type="button"
            aria-label="Добавить проект"
            title="Добавить проект"
            @click="addProjectStory"
          >
            <span class="project-story-avatar">+</span>
          </button>
        </div>

        <div class="project-sections">
          <ul
            v-if="selectedProjectRootCards.length"
            class="project-card-list"
            @dragover="handleCardDragOver($event, selectedProjectRootSectionId, null)"
          >
            <li
              v-for="card in selectedProjectRootCards"
              :key="card.id"
              class="project-card-row"
              draggable="true"
              @dragstart="handleCardDragStart(card.id)"
              @dragend="handleCardDragEnd"
              @dragover="handleCardDragOver($event, selectedProjectRootSectionId, card.id)"
            >
              <span class="project-card-checkbox" />
              <input
                v-if="editingCardId === card.id"
                v-model="editingCardDraft"
                class="project-card-title-input"
                @keydown.enter.prevent="submitCardRename"
                @keydown.esc.prevent="editingCardId = ''"
                @blur="submitCardRename"
              />
              <span v-else class="project-card-title" @dblclick.stop="startCardRenameByDoubleClick(card)">{{ card.title }}</span>
              <div class="project-item-menu-wrap">
                <button class="project-item-menu-btn" type="button" @click="cardMenuOpenId = cardMenuOpenId === card.id ? '' : card.id">⋯</button>
                <div v-if="cardMenuOpenId === card.id" class="project-item-menu">
                  <button type="button" @click="startCardRename(card)">Редактировать карточку</button>
                  <button type="button" class="danger" @click="deleteCard(card.id)">Удалить карточку</button>
                </div>
              </div>
            </li>
          </ul>

          <div
            v-if="selectedProjectSections.length"
            class="project-add-grid"
          >
            <div class="project-card-add-row" :class="{ 'has-value': Boolean((cardDraftBySection[selectedProjectRootSectionId] || '').trim()) || Boolean(addCardEditing[selectedProjectRootSectionId]) }">
              <button class="plus add-task-trigger add-task-check-trigger" type="button" @click.stop.prevent="startAddProjectCardEdit">
                <Plus v-if="!addCardEditing[selectedProjectRootSectionId]" class="add-task-plus-icon" />
              </button>
              <input
                v-if="addCardEditing[selectedProjectRootSectionId]"
                v-model="cardDraftBySection[selectedProjectRootSectionId]"
                class="add-input add-input-active"
                :data-add-card-input="selectedProjectRootSectionId"
                placeholder="Добавить карточку"
                @keydown.enter.prevent="addProjectCard"
                @keydown.esc.prevent="cancelAddProjectCardEdit($event)"
                @blur="handleAddProjectCardBlur"
              />
              <button
                v-else
                class="add-input add-input-trigger"
                type="button"
                @click.stop.prevent="startAddProjectCardEdit"
              >
                Добавить карточку
              </button>
            </div>
            <div class="project-section-add-row">
              <button class="project-section-icon-btn" type="button" aria-label="Добавить раздел" title="Добавить раздел" @click.stop.prevent="startAddSectionEdit">
                <ListPlus class="project-section-icon" />
              </button>
              <input
                v-if="addSectionEditing[selectedProjectKey]"
                v-model="sectionDraftByProject[selectedProjectKey]"
                class="add-input add-input-active"
                :data-add-section-input="selectedProjectKey"
                placeholder="Новый раздел"
                @keydown.enter.prevent="addSection"
                @keydown.esc.prevent="cancelAddSectionEdit(selectedProjectKey, $event)"
                @blur="handleAddSectionBlur(selectedProjectKey)"
              />
            </div>
          </div>

          <article v-for="section in selectedProjectSections" :key="section.id" class="project-section">
            <header class="project-section-head">
              <input
                v-if="editingSectionId === section.id"
                v-model="editingSectionDraft"
                class="project-section-title-input"
                @keydown.enter.prevent="submitSectionRename"
                @keydown.esc.prevent="editingSectionId = ''"
                @blur="submitSectionRename"
              />
              <h4 v-else class="project-section-title" @dblclick.stop="startSectionRenameByDoubleClick(section)">
                {{ section.title }}
              </h4>
              <div class="project-item-menu-wrap">
                <button class="project-item-menu-btn" type="button" @click="sectionMenuOpenId = sectionMenuOpenId === section.id ? '' : section.id">⋯</button>
                <div v-if="sectionMenuOpenId === section.id" class="project-item-menu">
                  <button type="button" @click="startSectionRename(section)">Редактировать раздел</button>
                  <button type="button" class="danger" @click="openDeleteSectionConfirm(section.id)">Удалить раздел</button>
                </div>
              </div>
            </header>

            <ul class="project-card-list" @dragover="handleCardDragOver($event, section.id, null)">
              <li
                v-for="card in cardsForSection(section.id)"
                :key="card.id"
                class="project-card-row"
                draggable="true"
                @dragstart="handleCardDragStart(card.id)"
                @dragend="handleCardDragEnd"
                @dragover="handleCardDragOver($event, section.id, card.id)"
              >
                <span class="project-card-checkbox" />
                <input
                  v-if="editingCardId === card.id"
                  v-model="editingCardDraft"
                  class="project-card-title-input"
                  @keydown.enter.prevent="submitCardRename"
                  @keydown.esc.prevent="editingCardId = ''"
                  @blur="submitCardRename"
                />
                <span v-else class="project-card-title" @dblclick.stop="startCardRenameByDoubleClick(card)">{{ card.title }}</span>
                <div class="project-item-menu-wrap">
                  <button class="project-item-menu-btn" type="button" @click="cardMenuOpenId = cardMenuOpenId === card.id ? '' : card.id">⋯</button>
                  <div v-if="cardMenuOpenId === card.id" class="project-item-menu">
                    <button type="button" @click="startCardRename(card)">Редактировать карточку</button>
                    <button type="button" class="danger" @click="deleteCard(card.id)">Удалить карточку</button>
                  </div>
                </div>
              </li>
            </ul>

            <div class="project-add-grid">
              <div class="project-card-add-row" :class="{ 'has-value': Boolean((cardDraftBySection[section.id] || '').trim()) || Boolean(addCardEditing[section.id]) }">
                <button class="plus add-task-trigger add-task-check-trigger" type="button" @click.stop.prevent="startAddCardEdit(section.id)">
                  <Plus v-if="!addCardEditing[section.id]" class="add-task-plus-icon" />
                </button>
                <input
                  v-if="addCardEditing[section.id]"
                  v-model="cardDraftBySection[section.id]"
                  class="add-input add-input-active"
                  :data-add-card-input="section.id"
                  placeholder="Новая карточка"
                  @keydown.enter.prevent="addCard(section.id)"
                  @keydown.esc.prevent="cancelAddCardEdit(section.id, $event)"
                  @blur="handleAddCardBlur(section.id)"
                />
                <button
                  v-else
                  class="add-input add-input-trigger"
                  type="button"
                  @click.stop.prevent="startAddCardEdit(section.id)"
                >
                  Добавить карточку
                </button>
              </div>
              <div class="project-section-add-row">
                <button class="project-section-icon-btn" type="button" aria-label="Добавить раздел" title="Добавить раздел" @click.stop.prevent="startAddSectionEdit">
                  <ListPlus class="project-section-icon" />
                </button>
              </div>
            </div>
          </article>
        </div>

        <div class="project-actions">
          <button
            class="project-action-btn"
            type="button"
            aria-label="Переименовать проект"
            title="Переименовать проект"
            @click="openRenameProjectModal"
          >
            <SquarePen :size="16" />
          </button>
          <button
            class="project-action-btn"
            type="button"
            aria-label="Переместить проект"
            title="Переместить проект"
            @click="openMoveProjectModal"
          >
            <Grip :size="16" />
          </button>
          <button
            class="project-action-btn danger"
            type="button"
            aria-label="Удалить проект"
            title="Удалить проект"
            @click="openDeleteProjectConfirm"
          >
            <Trash2 :size="16" />
          </button>
        </div>
        <div class="project-sidebar-resize-handle" @mousedown="startSidebarResize" />
      </aside>

      <section v-if="activeSection === 'board'" class="board" :style="boardInlineStyle">
        <div ref="daysScrollRef" class="days-scroll">
          <TransitionGroup :name="daysTransitionName" tag="div" class="days-track">
            <article
              v-for="day in weekDays"
              :key="day.dateKey"
              :data-date-key="day.dateKey"
              class="day-col"
              :class="{ today: day.isToday }"
            >
            <header class="day-head">
              <h3 :title="day.fullTitle">{{ day.title }}</h3>
              <div class="day-progress">
                <span>{{ dayPercent(day.dateKey) }}%</span>
                <span class="progress-ring" :class="{ complete: dayPercent(day.dateKey) === 100 }" />
              </div>
            </header>

            <div class="day-split">
              <section class="day-top">
                <ul class="day-list">
                  <li
                    v-for="task in tasksByDay.get(day.dateKey) || []"
                    :key="task.id"
                    class="task-row"
                    @click.stop="handleTaskRowClick(task.id)"
                    @dblclick.stop.prevent="startTaskTitleEdit(task)"
                  >
                    <span class="check" :class="{ done: task.completed }">
                      <Check v-if="task.completed" class="check-icon" />
                    </span>
                    <input
                      v-if="isTaskTitleEditing(task.id)"
                      v-model="editingTaskTitles[task.id]"
                      class="task-name task-name-edit"
                      :data-task-edit="task.id"
                      @click.stop
                      @keydown.enter.prevent="handleTaskTitleEnter(task.id, $event)"
                      @keydown.esc.prevent="handleTaskTitleEscape(task.id, $event)"
                      @blur="handleTaskTitleBlur(task.id)"
                    />
                    <span v-else class="task-name" :class="{ done: task.completed }">{{ task.title }}</span>
                    <span v-if="!isTaskTitleEditing(task.id)" class="task-row-actions">
                      <span v-if="scoreLabel(task)" class="score">{{ scoreLabel(task) }}</span>
                      <button
                        class="task-delete"
                        type="button"
                        aria-label="Удалить задачу"
                        title="Удалить задачу"
                        @click.stop.prevent="removeTaskById(task.id)"
                      >
                        <CircleX class="task-delete-icon" />
                      </button>
                    </span>
                  </li>

                  <li
                    class="task-row add-row"
                    :class="{ 'has-value': Boolean((dailyDrafts[day.dateKey] || '').trim()) || Boolean(addTaskEditing[day.dateKey]) }"
                    @click.stop
                  >
                    <button class="plus add-task-trigger add-task-check-trigger" type="button" @click.stop.prevent="startAddTaskEdit(day.dateKey)">
                      <Plus v-if="!addTaskEditing[day.dateKey]" class="add-task-plus-icon" />
                    </button>
                    <input
                      v-if="addTaskEditing[day.dateKey]"
                      v-model="dailyDrafts[day.dateKey]"
                      class="add-input add-input-active"
                      :data-add-input="day.dateKey"
                      placeholder="Новая задача"
                      @keydown.enter.prevent="addTaskForDay(day.dateKey)"
                      @keydown.esc.prevent="cancelAddTaskEdit(day.dateKey, $event)"
                      @blur="handleAddTaskBlur(day.dateKey)"
                    />
                    <button
                      v-else
                      class="add-input add-input-trigger"
                      type="button"
                      @click.stop.prevent="startAddTaskEdit(day.dateKey)"
                    >
                      Добавить задачу
                    </button>
                  </li>
                </ul>
              </section>

              <section class="day-income" @click.stop>
                <button
                  class="finance-total"
                  type="button"
                  :aria-expanded="isFinanceTotalExpanded(day.dateKey)"
                  @click.stop="toggleFinanceTotalExpanded(day.dateKey)"
                >
                  <span>Итого</span>
                  <strong>{{ formatMoney(dayIncomeTotal(day.dateKey)) }}</strong>
                </button>
                <div v-if="isFinanceTotalExpanded(day.dateKey)" class="finance-total-body">
                  <ul class="finance-total-stats">
                    <li class="finance-total-stat">
                      <span>Неделя</span>
                      <strong :class="{ positive: periodNetByDate(day.dateKey, 'week') > 0, negative: periodNetByDate(day.dateKey, 'week') < 0 }">
                        {{ formatSignedMoney(periodNetByDate(day.dateKey, 'week')) }}
                      </strong>
                    </li>
                    <li class="finance-total-stat">
                      <span>Месяц</span>
                      <strong :class="{ positive: periodNetByDate(day.dateKey, 'month') > 0, negative: periodNetByDate(day.dateKey, 'month') < 0 }">
                        {{ formatSignedMoney(periodNetByDate(day.dateKey, 'month')) }}
                      </strong>
                    </li>
                    <li class="finance-total-stat">
                      <span>Год</span>
                      <strong :class="{ positive: periodNetByDate(day.dateKey, 'year') > 0, negative: periodNetByDate(day.dateKey, 'year') < 0 }">
                        {{ formatSignedMoney(periodNetByDate(day.dateKey, 'year')) }}
                      </strong>
                    </li>
                  </ul>
                </div>
                <ul class="income-list">
                  <li
                    v-for="earning in earningsByDay.get(day.dateKey) || []"
                    :key="`earning-${earning.id}`"
                    class="income-accordion"
                  >
                    <div
                      class="income-accordion-trigger"
                      @click.stop
                    >
                      <button
                        class="income-accordion-title income-title-button"
                        type="button"
                        @click.stop="toggleEarningExpanded(day.dateKey, earning.id)"
                      >
                        {{ displayProjectTitle(earning.projectName) }}
                      </button>
                      <span class="income-accordion-right" @mousedown.stop @click.stop>
                        <input
                          v-if="isEarningAmountEditing(day.dateKey, earning.id)"
                          v-model="editingEarningAmounts[earningAmountEditKey(day.dateKey, earning.id)]"
                          class="income-amount-edit"
                          :data-earning-edit="earningAmountEditKey(day.dateKey, earning.id)"
                          @mousedown.stop
                          @click.stop
                          @keydown.enter.prevent="handleEarningAmountEnter(day.dateKey, earning, $event)"
                          @keydown.esc.prevent="handleEarningAmountEscape(day.dateKey, earning, $event)"
                          @blur="handleEarningAmountBlur(day.dateKey, earning)"
                        />
                        <button
                          v-else
                          class="income-accordion-amount income-amount-hitbox"
                          type="button"
                          @mousedown.stop
                          @dblclick.stop.prevent="startEarningAmountEdit(day.dateKey, earning)"
                        >
                          {{ formatMoney(earning.amount) }}
                        </button>
                      </span>
                    </div>

                    <div v-if="isEarningExpanded(day.dateKey, earning.id)" class="income-accordion-body">
                      <ul class="income-stats">
                        <li class="income-stat">
                          <span>Вчера</span>
                          <span class="income-stat-right">
                            <strong class="income-stat-value-amount">
                              {{ formatDelta(deltaByPeriod(day.dateKey, earning.projectName, 'yesterday')) }}
                            </strong>
                            <strong
                              class="income-stat-value-percent"
                              :class="{ positive: deltaPercentByPeriod(day.dateKey, earning.projectName, 'yesterday') > 0, negative: deltaPercentByPeriod(day.dateKey, earning.projectName, 'yesterday') < 0 }"
                            >
                              {{ formatPercent(deltaPercentByPeriod(day.dateKey, earning.projectName, 'yesterday')) }}
                              <ChevronUp
                                v-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'yesterday') > 0"
                                class="income-stat-percent-icon"
                              />
                              <ChevronDown
                                v-else-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'yesterday') < 0"
                                class="income-stat-percent-icon"
                              />
                            </strong>
                          </span>
                        </li>
                        <li class="income-stat">
                          <span>Неделя</span>
                          <span class="income-stat-right">
                            <strong class="income-stat-value-amount">
                              {{ formatDelta(deltaByPeriod(day.dateKey, earning.projectName, 'week')) }}
                            </strong>
                            <strong
                              class="income-stat-value-percent"
                              :class="{ positive: deltaPercentByPeriod(day.dateKey, earning.projectName, 'week') > 0, negative: deltaPercentByPeriod(day.dateKey, earning.projectName, 'week') < 0 }"
                            >
                              {{ formatPercent(deltaPercentByPeriod(day.dateKey, earning.projectName, 'week')) }}
                              <ChevronUp
                                v-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'week') > 0"
                                class="income-stat-percent-icon"
                              />
                              <ChevronDown
                                v-else-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'week') < 0"
                                class="income-stat-percent-icon"
                              />
                            </strong>
                          </span>
                        </li>
                        <li class="income-stat">
                          <span>Месяц</span>
                          <span class="income-stat-right">
                            <strong class="income-stat-value-amount">
                              {{ formatDelta(deltaByPeriod(day.dateKey, earning.projectName, 'month')) }}
                            </strong>
                            <strong
                              class="income-stat-value-percent"
                              :class="{ positive: deltaPercentByPeriod(day.dateKey, earning.projectName, 'month') > 0, negative: deltaPercentByPeriod(day.dateKey, earning.projectName, 'month') < 0 }"
                            >
                              {{ formatPercent(deltaPercentByPeriod(day.dateKey, earning.projectName, 'month')) }}
                              <ChevronUp
                                v-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'month') > 0"
                                class="income-stat-percent-icon"
                              />
                              <ChevronDown
                                v-else-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'month') < 0"
                                class="income-stat-percent-icon"
                              />
                            </strong>
                          </span>
                        </li>
                        <li class="income-stat">
                          <span>Год</span>
                          <span class="income-stat-right">
                            <strong class="income-stat-value-amount">
                              {{ formatDelta(deltaByPeriod(day.dateKey, earning.projectName, 'year')) }}
                            </strong>
                            <strong
                              class="income-stat-value-percent"
                              :class="{ positive: deltaPercentByPeriod(day.dateKey, earning.projectName, 'year') > 0, negative: deltaPercentByPeriod(day.dateKey, earning.projectName, 'year') < 0 }"
                            >
                              {{ formatPercent(deltaPercentByPeriod(day.dateKey, earning.projectName, 'year')) }}
                              <ChevronUp
                                v-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'year') > 0"
                                class="income-stat-percent-icon"
                              />
                              <ChevronDown
                                v-else-if="deltaPercentByPeriod(day.dateKey, earning.projectName, 'year') < 0"
                                class="income-stat-percent-icon"
                              />
                            </strong>
                          </span>
                        </li>
                      </ul>
                    </div>
                  </li>
                </ul>
              </section>
            </div>
            </article>
          </TransitionGroup>
        </div>

        <nav class="nav-controls">
          <button @click="shiftDays(-7)">«</button>
          <button @click="shiftDays(-1)">‹</button>
          <button @click="setTodayWithAnimation()">•</button>
          <button @click="shiftDays(1)">›</button>
          <button @click="shiftDays(7)">»</button>
        </nav>
      </section>
      <section v-else class="notes-screen" :style="notesInlineStyle">
        <NotesBoard />
      </section>

      <p v-if="errorText" class="status error">{{ errorText }}</p>
      <p v-if="successText" class="status ok">{{ successText }}</p>
      <p v-if="loading" class="status">Проверка сессии…</p>

      <div v-if="deleteProjectConfirmOpen" class="modal-backdrop" @click.self="cancelDeleteProjectConfirm">
        <div class="modal-card">
          <h3>Удалить проект?</h3>
          <p>Проект и его задачи в этом сайдбаре будут удалены.</p>
          <div class="modal-actions">
            <button type="button" class="modal-btn" @click="cancelDeleteProjectConfirm">Отмена</button>
            <button type="button" class="modal-btn danger" @click="confirmDeleteProject">Удалить</button>
          </div>
        </div>
      </div>

      <div v-if="deleteSectionConfirmOpen" class="modal-backdrop" @click.self="cancelDeleteSectionConfirm">
        <div class="modal-card">
          <h3>Удалить раздел?</h3>
          <p>Раздел будет удалён вместе со всеми карточками.</p>
          <div class="modal-actions">
            <button type="button" class="modal-btn" @click="cancelDeleteSectionConfirm">Отмена</button>
            <button type="button" class="modal-btn danger" @click="confirmDeleteSection">Удалить</button>
          </div>
        </div>
      </div>

      <div v-if="renameProjectModalOpen" class="modal-backdrop" @click.self="closeRenameProjectModal">
        <div class="modal-card">
          <h3>Переименовать проект</h3>
          <input
            v-model="renameProjectDraft"
            class="modal-input"
            @keydown.enter.prevent="submitRenameProject"
          />
          <div class="modal-actions">
            <button type="button" class="modal-btn" @click="closeRenameProjectModal">Отмена</button>
            <button type="button" class="modal-btn primary" @click="submitRenameProject">Сохранить</button>
          </div>
        </div>
      </div>

      <div v-if="moveProjectModalOpen" class="modal-backdrop" @click.self="closeMoveProjectModal">
        <div class="modal-card move-project-modal">
          <h3>Переместить проект</h3>
          <ul class="move-project-list">
            <li
              v-for="story in moveProjectDraft"
              :key="`move-${story.key}`"
              class="move-project-row"
              :class="{ dragging: draggingProjectKey === story.key }"
              draggable="true"
              @dragstart="handleMoveDragStart(story.key)"
              @dragend="handleMoveDragEnd"
              @dragover="handleMoveDragOver($event, story.key)"
            >
              <span class="move-project-handle">⋮⋮</span>
              <span>{{ story.name }}</span>
            </li>
          </ul>
          <div class="modal-actions">
            <button type="button" class="modal-btn" @click="closeMoveProjectModal">Отмена</button>
            <button type="button" class="modal-btn primary" @click="saveProjectOrder">Сохранить</button>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
.screen {
  min-height: 100vh;
  display: flex;
  background: #f3f4f6;
  color: #242a31;
  font-family: 'Rubik', 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
}

.mobile-nav-toggle {
  display: none;
  position: fixed;
  left: 16px;
  top: 16px;
  z-index: 50;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: #e5ebf5;
  color: #334155;
}

.app-sidebar {
  position: fixed;
  left: 16px;
  top: 16px;
  z-index: 40;
  width: 56px;
  border-radius: 16px;
  padding: 8px;
  background: #e8edf6;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.2s ease;
}

.app-sidebar-spacer {
  flex: 1;
}

.app-sidebar.collapsed {
  transform: translateX(-88px);
}

.app-sidebar-toggle {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 41;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  background: #e8edf6;
  color: #4b5c72;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: left 0.2s ease;
}

.app-sidebar-toggle.collapsed {
  left: 8px;
}

.project-sidebar {
  position: fixed;
  left: 72px;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 240px;
  border-radius: 0;
  padding: 24px 16px 16px;
  background: #eff1f5;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: hidden;
}

.project-sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
  cursor: ew-resize;
  z-index: 6;
}

.project-stories {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  overflow-x: auto;
  padding: 0;
  scrollbar-width: thin;
}

.project-story {
  border: 0;
  background: transparent;
  padding: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #313842;
  flex: 0 0 auto;
  max-width: 62px;
}

.project-story-avatar {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  border: 2px solid #b5bcca;
  background: #dce9ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #28313a;
}

.project-story.active .project-story-avatar {
  border-color: #abf498;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9) inset;
}

.project-story-name {
  font-size: 15px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  text-align: center;
}

.project-story-add .project-story-avatar {
  background: #e6e9ee;
  border-color: #d9dce3;
  font-size: 26px;
  font-weight: 400;
  line-height: 1;
}

.project-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  min-height: 0;
}

.project-section {
  background: transparent;
  border-radius: 0;
  padding: 0;
}

.project-section-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 0;
  min-height: 30px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #eff1f5;
}

.project-section-title {
  margin: 0;
  font-family: 'Benzin-Semibold', 'Rubik', sans-serif;
  font-size: 15px;
  line-height: normal;
  font-weight: 400;
  letter-spacing: 0;
  color: #242a31;
  flex: 1;
}

.project-section-title-input,
.project-card-title-input {
  border: 0;
  border-radius: 6px;
  background: #f7f9fc;
  color: #56627a;
  padding: 2px 6px;
  min-height: 28px;
  font-size: 15px;
  width: 100%;
  outline: 0;
}

.project-item-menu-wrap {
  position: relative;
}

.project-item-menu-btn {
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8fa0b5;
  cursor: pointer;
  opacity: 1;
}

.project-item-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  min-width: 170px;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #dfe5ef;
  box-shadow: 0 8px 18px rgba(17, 24, 39, 0.18);
  z-index: 5;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-item-menu button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  min-height: 30px;
  padding: 0 8px;
  text-align: left;
  color: #3c4a5c;
  cursor: pointer;
}

.project-item-menu button:hover {
  background: #f4f7fb;
}

.project-item-menu button.danger {
  color: #c34d77;
}

.project-card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.project-card-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  border-radius: 8px;
  background: #eff1f5;
  color: #38414b;
  padding: 6px 8px;
}

.project-card-title {
  flex: 1;
  font-size: 15px;
  line-height: normal;
  letter-spacing: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card-checkbox {
  width: 16px;
  height: 16px;
  border: 2px solid #b7b7b7;
  border-radius: 4px;
  flex: 0 0 auto;
  margin-top: 0;
  background: transparent;
}

.project-card-add-row,
.project-section-add-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  height: 32px;
  padding: 6px 8px;
  border-radius: 8px;
  background: #ffffff;
  color: #38414b;
}

.project-card-add-row .add-input,
.project-section-add-row .add-input {
  font-size: 15px;
  line-height: normal;
  color: rgba(163, 171, 189, 0.8);
}

.project-section-icon-btn {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #8d97a7;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.project-section-icon {
  width: 16px;
  height: 16px;
}

.project-card-add-row:hover,
.project-section-add-row:hover,
.project-card-add-row.has-value,
.project-section-add-row.has-value,
.project-card-add-row:focus-within,
.project-section-add-row:focus-within {
  background: #f7f9fc;
}

.project-add-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  gap: 4px;
  min-height: 32px;
  height: 32px;
}

.project-add-grid .project-card-add-row {
  min-width: 0;
}

.project-add-grid .project-section-add-row {
  width: 32px;
  min-width: 32px;
  max-width: 32px;
  padding: 0;
  justify-content: center;
}

.project-actions {
  margin-top: auto;
  display: flex;
  flex-direction: row;
  gap: 6px;
  padding-top: 16px;
}

.project-action-btn {
  border: 0;
  border-radius: 8px;
  width: 34px;
  height: 34px;
  padding: 0;
  background: transparent;
  color: #444444;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.project-action-btn:hover {
  background: rgba(255, 255, 255, 0.45);
}

.project-action-btn.danger {
  color: #b74c70;
}


.section-icon {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: #f8fbff;
  color: #4b5c72;
  padding: 0;
  overflow: hidden;
}

.section-icon.active {
  background: #d6e4fb;
  color: #1f3b67;
}

.section-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}

.day-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.task-row {
  display: flex;
  align-items: center;
  min-height: 34px;
  gap: 6px;
  cursor: pointer;
  color: #38414b;
  padding: 6px 8px;
  border-radius: 8px;
  background: #ffffff;
  margin-bottom: 0;
}

.task-row:hover {
  background: #f7f9fc;
}

.task-row.add-row.has-value,
.task-row.add-row:focus-within {
  background: #f7f9fc;
}

.check {
  width: 16px;
  height: 16px;
  border: 2px solid #b5bcca;
  border-radius: 4px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.check.done {
  background: #85d08a;
  border-color: #6bc276;
}

.check-icon {
  width: 11px;
  height: 11px;
  color: #ffffff;
  stroke-width: 3;
}

.task-name {
  font-size: 15px;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-name.done {
  text-decoration: line-through;
  color: #8e99a8;
}

.task-name-edit {
  border: 1px solid #c6d2e4;
  border-radius: 6px;
  background: #ffffff;
  color: #38414b;
  padding: 4px 8px;
  min-height: 28px;
}

.score {
  color: #38414b;
  font-size: 12px;
  background: #eff1f5;
  border-radius: 999px;
  padding: 4px 8px;
}

.task-row-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.task-delete {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #adb5c3;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity 0.16s ease, background-color 0.16s ease, color 0.16s ease;
}

.task-delete-icon {
  width: 16px;
  height: 16px;
}

.task-row:hover .task-delete,
.task-row:focus-within .task-delete {
  opacity: 1;
  pointer-events: auto;
}

.task-delete:hover {
  background: #f4c2d4;
  color: #e46694;
}

.add-row {
  color: rgba(163, 171, 189, 0.8);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.day-col:hover .add-row,
.add-row:focus-within,
.add-row.has-value {
  opacity: 1;
  pointer-events: auto;
}

.plus {
  font-size: 16px;
}

.add-task-trigger {
  border: 0;
  background: transparent;
  padding: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.add-task-check-trigger {
  width: 16px;
  height: 16px;
  min-width: 16px;
  min-height: 16px;
  flex: 0 0 16px;
  border: 2px solid #b5bcca;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #8d97a7;
}

.add-task-plus-icon {
  width: 11px;
  height: 11px;
  stroke-width: 3;
}

.add-input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: rgba(163, 171, 189, 0.8);
  font: inherit;
}

.add-input-active {
  border-radius: 0;
  padding: 0;
  background: transparent;
  color: #56627a;
}

.add-input-active:focus {
  background: transparent;
}

.add-input-trigger {
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.board {
  margin-left: 312px;
  flex: 1;
  position: relative;
  min-width: 0;
}

.notes-screen {
  margin-left: 88px;
  flex: 1;
  padding: 16px;
}

.days-scroll {
  min-width: 0;
  overflow: hidden;
  min-height: 100vh;
}

.days-track {
  display: flex;
  width: 100%;
  min-height: 100vh;
}

.days-left-enter-active,
.days-left-leave-active,
.days-right-enter-active,
.days-right-leave-active {
  transition: transform 0.24s ease;
}

.days-left-enter-from {
  transform: translateX(24px);
}

.days-left-leave-to {
  transform: translateX(-24px);
}

.days-right-enter-from {
  transform: translateX(-24px);
}

.days-right-leave-to {
  transform: translateX(24px);
}

.days-left-move,
.days-right-move {
  transition: transform 0.24s ease;
}

.day-col {
  box-sizing: border-box;
  flex: 0 0 calc(100% / 4);
  width: calc(100% / 4);
  min-width: calc(100% / 4);
  max-width: calc(100% / 4);
  border-right: 1px dashed #e7e7e8;
  padding: 24px 16px 96px;
  cursor: default;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

.day-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
  padding-left: 8px;
}

.day-head h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-family: 'Benzin-Semibold', 'Rubik', sans-serif;
  color: #242a31;
}

.day-col.today .day-head h3 {
  color: #73777b;
}

.day-progress {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #73777b;
  font-size: 12px;
  line-height: 1;
}

.progress-ring {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 2px solid #b5bcca;
  box-sizing: border-box;
  position: relative;
}

.progress-ring.complete {
  background: #79d176;
  border-color: #79d176;
}

.progress-ring.complete::before {
  content: '✓';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #ffffff;
}

.day-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.day-top,
.day-income {
  flex: 1;
  min-height: 0;
}

.day-list {
  height: 100%;
  overflow: auto;
}

.day-income {
  border-top: 1px dashed #e7e7e8;
  margin-top: 16px;
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: visible;
}

.income-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: visible;
}

.income-accordion {
  background: #ffffff;
  border-radius: 10px;
  border: 0;
  overflow: hidden;
}

.income-accordion-trigger {
  width: 100%;
  min-height: 34px;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 5px;
  gap: 8px;
  text-align: left;
}

.income-accordion-title {
  color: #222a32;
  leading-trim: both;
  text-edge: cap;
  font-family: 'Benzin-Semibold', 'Rubik', sans-serif;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.income-title-button {
  border: 0;
  background: transparent;
  padding: 0;
  text-align: left;
  cursor: pointer;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}

.income-accordion-right {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  margin-left: 8px;
}

.income-accordion-amount {
  color: #3b4b5f;
  font-size: 15px;
  font-weight: 500;
}

.income-amount-hitbox {
  border: 0;
  border-radius: 6px;
  background: #ffffff;
  width: 104px;
  min-width: 104px;
  max-width: 104px;
  min-height: 24px;
  padding: 0 8px;
  cursor: pointer;
  font-family: inherit;
  text-align: right;
  white-space: nowrap;
}

.income-amount-hitbox:hover {
  background: #eff1f5;
}

.income-amount-edit {
  width: 104px;
  min-width: 104px;
  max-width: 104px;
  height: 24px;
  border: 1px solid #c6d2e4;
  border-radius: 6px;
  background: #ffffff;
  color: #3b4b5f;
  font-size: 14px;
  font-family: inherit;
  text-align: right;
  padding: 0 8px;
  outline: 0;
  white-space: nowrap;
}

.income-accordion-body {
  border-top: 0;
  background: transparent;
  padding: 0 8px 6px;
}

.income-row {
  display: grid;
  grid-template-columns: 1fr 74px 24px;
  gap: 6px;
  align-items: center;
  background: #ffffff;
  border-radius: 8px;
  padding: 4px 6px;
}

.income-project,
.income-amount {
  border: 0;
  outline: 0;
  background: transparent;
  color: #38414b;
  font-family: inherit;
  font-size: 14px;
}

.income-amount {
  text-align: right;
}

.income-remove {
  border: 0;
  border-radius: 6px;
  background: #eff1f5;
  color: #768298;
  width: 24px;
  height: 24px;
  line-height: 1;
  font-size: 16px;
}

.income-add {
  border: 0;
  border-radius: 8px;
  background: #ffffff;
  color: rgba(163, 171, 189, 0.95);
  min-height: 30px;
  text-align: left;
  padding: 0 8px;
  font-size: 15px;
}

.income-stats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.income-stat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: 0;
  background: transparent;
  min-height: 30px;
  padding: 0;
  font-size: 14px;
  color: #607187;
}

.income-stat strong {
  font-size: 14px;
  color: #2f4055;
  font-weight: 500;
}

.income-stat-value-percent {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: 24px;
  font-size: 10px;
  font-weight: 400;
}

.income-stat-value-amount {
  color: #38414b;
  font-weight: 500;
}

.income-stat-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.income-stat strong.positive {
  color: #64a753;
  background: #d7face;
}

.income-stat strong.negative {
  color: #e46694;
  background: #f4c2d4;
}

.income-stat-percent-icon {
  width: 12px;
  height: 12px;
}

.finance-total {
  margin-top: 6px;
  border: 0;
  border-radius: 10px;
  background: #eff1f5;
  color: #1f2a36;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 14px;
  width: 100%;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.finance-total:hover {
  background: #e4e8ef;
}

.finance-total strong {
  font-size: 14px;
}

.finance-total-body {
  padding: 4px 10px 2px;
}

.finance-total-stats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.finance-total-stat {
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #607187;
}

.finance-total-stat strong {
  color: #2f4055;
  font-weight: 500;
}

.finance-total-stat strong.positive {
  color: #64a753;
}

.finance-total-stat strong.negative {
  color: #e46694;
}

.nav-controls {
  position: fixed;
  right: 24px;
  bottom: 24px;
  display: flex;
  gap: 4px;
  background: #eff1f5;
  border-radius: 16px;
  padding: 12px;
}

.nav-controls button,
.sidebar-logout {
  border: 0;
  border-radius: 8px;
  background: #eff1f5;
  color: #404954;
  cursor: pointer;
  min-width: 40px;
  min-height: 40px;
  font-size: 26px;
  line-height: 1;
}

.nav-controls button:hover,
.sidebar-logout:hover {
  background: #dae2ec;
}

.sidebar-logout {
  padding: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.logout-icon {
  width: 20px;
  height: 20px;
}

.status {
  position: fixed;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  background: #edf1f7;
  border: 1px solid #d9e0ea;
  border-radius: 10px;
  padding: 8px 12px;
  z-index: 30;
}

.status.error {
  color: #b73737;
}

.status.ok {
  color: #277a44;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.36);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 70;
  padding: 16px;
}

.modal-card {
  width: min(460px, 100%);
  border-radius: 14px;
  background: #ffffff;
  padding: 16px;
  box-shadow: 0 12px 30px rgba(17, 24, 39, 0.26);
}

.modal-card h3 {
  margin: 0 0 10px;
  font-size: 18px;
}

.modal-card p {
  margin: 0 0 14px;
  color: #4f5d70;
}

.modal-input {
  width: 100%;
  height: 36px;
  border: 1px solid #c6d2e4;
  border-radius: 8px;
  padding: 0 10px;
  margin-bottom: 14px;
  font: inherit;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.modal-btn {
  border: 0;
  border-radius: 8px;
  height: 34px;
  padding: 0 12px;
  background: #eff1f5;
  color: #39485c;
  cursor: pointer;
}

.modal-btn.primary {
  background: #d6e4fb;
  color: #1f3b67;
}

.modal-btn.danger {
  background: #f8d8e4;
  color: #b63e67;
}

.move-project-modal {
  max-height: min(80vh, 620px);
  display: flex;
  flex-direction: column;
}

.move-project-list {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
}

.move-project-row {
  min-height: 38px;
  border-radius: 8px;
  background: #f7f9fc;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
}

.move-project-row.dragging {
  opacity: 0.5;
}

.move-project-handle {
  color: #8d9bb0;
}

@media (max-width: 980px) {
  .mobile-nav-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .app-sidebar {
    transform: translateX(-140%);
    transition: transform 0.2s ease;
  }
  .app-sidebar.open {
    transform: translateX(0);
  }
  .board,
  .notes-screen {
    margin-left: 0;
  }
  .project-sidebar {
    display: none;
  }
  .app-sidebar-toggle {
    display: none;
  }
  .nav-controls {
    right: 16px;
    bottom: 96px;
  }
}
</style>
