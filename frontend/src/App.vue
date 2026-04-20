<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ChevronDown, ChevronUp, LogOut, Trash2 } from '@lucide/vue'

import type { SessionUser } from '@/lib/api'
import { api } from '@/lib/api'
import { useAppState, type DailyProjectEarning, type TaskItem } from '@/lib/app-state'

import AuthPanel from '@/components/auth/AuthPanel.vue'

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
const editingEarningAmounts = reactive<Record<string, string>>({})
const skipEarningBlurSave = ref<string | null>(null)
const editingTaskTitles = reactive<Record<string, string>>({})
const skipTaskTitleBlurSave = ref<string | null>(null)
const taskRowClickTimers = new Map<string, number>()
let tickInterval: number | null = null

function setError(message: string) {
  errorText.value = message
  successText.value = ''
}

function setSuccess(message: string) {
  successText.value = message
  errorText.value = ''
}

function clearMessages() {
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
  const start = addDays(end, -5)
  return Array.from({ length: 6 }, (_, i) => {
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

type DisplayEarning = DailyProjectEarning & {
  sourceEntryId: string | null
}

const REMOVED_PROJECT_NAMES = new Set(['новый проект'])
const EXPENSE_PROJECT_NAMES = new Set(['расход', 'расходы'])

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

async function hydrateSession() {
  loading.value = true
  clearMessages()
  try {
    const result = await api.session()
    user.value = result.user
    if (user.value) {
      await board.load()
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
    user.value = result.user
    await board.load()
    await nextTick()
    alignTodayColumnToRight()
    setSuccess('Вход выполнен')
    password.value = ''
  } catch (error) {
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
    user.value = result.user
    await board.load()
    await nextTick()
    alignTodayColumnToRight()
    setSuccess('Аккаунт создан')
    registerPassword.value = ''
  } catch (error) {
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
  try {
    await board.addTaskForDate(dateKey, 'todo', draft)
    dailyDrafts[dateKey] = ''
    addTaskEditing[dateKey] = true
    await nextTick()
    const input = document.querySelector<HTMLInputElement>(`input[data-add-input="${dateKey}"]`)
    input?.focus()
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

function earningAmountEditKey(dateKey: string, earningId: string) {
  return `${dateKey}:${earningId}`
}

function displayProjectTitle(projectName: string) {
  const value = projectName.trim()
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
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

onMounted(() => {
  tickInterval = window.setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
  void hydrateSession()
})

onBeforeUnmount(() => {
  if (tickInterval) {
    window.clearInterval(tickInterval)
    tickInterval = null
  }
  for (const timer of taskRowClickTimers.values()) {
    window.clearTimeout(timer)
  }
  taskRowClickTimers.clear()
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
      <section class="board">
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
                    <span class="check" :class="{ done: task.completed }" />
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
                        <Trash2 class="task-delete-icon" />
                      </button>
                    </span>
                  </li>

                  <li
                    class="task-row add-row"
                    :class="{ 'has-value': Boolean((dailyDrafts[day.dateKey] || '').trim()) || Boolean(addTaskEditing[day.dateKey]) }"
                    @click.stop
                  >
                    <button class="plus add-task-trigger" type="button" @click.stop.prevent="startAddTaskEdit(day.dateKey)">⊕</button>
                    <input
                      v-if="addTaskEditing[day.dateKey]"
                      v-model="dailyDrafts[day.dateKey]"
                      class="add-input"
                      :data-add-input="day.dateKey"
                      placeholder="Добавить задачу"
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
                <div class="finance-total">
                  <span>Итого</span>
                  <strong>{{ formatMoney(dayIncomeTotal(day.dateKey)) }}</strong>
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

      <button class="logout" :disabled="busy" aria-label="Выйти" title="Выйти" @click="handleLogout">
        <LogOut class="logout-icon" />
      </button>

      <p v-if="errorText" class="status error">{{ errorText }}</p>
      <p v-if="successText" class="status ok">{{ successText }}</p>
      <p v-if="loading" class="status">Проверка сессии…</p>
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
  margin-bottom: 2px;
}

.task-row:hover {
  background: #f7f9fc;
}

.check {
  width: 16px;
  height: 16px;
  border: 2px solid #b5bcca;
  border-radius: 4px;
  flex: none;
}

.check.done {
  background: #85d08a;
  border-color: #6bc276;
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
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 999px;
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
  width: 12px;
  height: 12px;
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

.add-input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: rgba(163, 171, 189, 0.8);
  font: inherit;
}

.add-input-trigger {
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.board {
  flex: 1;
  position: relative;
  min-width: 0;
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
  flex: 0 0 calc(100% / 6);
  width: calc(100% / 6);
  min-width: calc(100% / 6);
  max-width: calc(100% / 6);
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
  border-radius: 10px;
  background: #eff1f5;
  color: #1f2a36;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  font-size: 14px;
}

.finance-total strong {
  font-size: 14px;
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
.logout {
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
.logout:hover {
  background: #dae2ec;
}

.logout {
  position: fixed;
  left: 24px;
  bottom: 24px;
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

@media (max-width: 980px) {
  .nav-controls {
    right: 16px;
    bottom: 96px;
  }
}
</style>
