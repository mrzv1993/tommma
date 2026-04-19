<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

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

const nowMs = ref(Date.now())
const dailyDrafts = reactive<Record<string, string>>({})
const earningDraftNames = reactive<Record<string, string>>({})
const expenseDraftNames = reactive<Record<string, string>>({})
const dailyExpensesByDate = ref<Record<string, DailyProjectEarning[]>>({})
let tickInterval: number | null = null
const EXPENSES_STORAGE_KEY = 'tommma.daily.expenses.v1'

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

function formatDateLabel(dateKey: string) {
  return parseDateKey(dateKey).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  })
}

function weekStart(dateKey: string) {
  const date = parseDateKey(dateKey)
  const day = date.getDay()
  return addDays(date, -day)
}

const weekDays = computed(() => {
  const start = weekStart(selectedDateKey.value)
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i)
    const key = toDateKey(date)
    return {
      dateKey: key,
      title: formatDateLabel(key),
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

const earningsByDay = computed(() => {
  const map = new Map<string, DailyProjectEarning[]>()
  for (const day of weekDays.value) {
    map.set(day.dateKey, board.getDayEarnings(day.dateKey))
  }
  return map
})

const expensesByDay = computed(() => {
  const map = new Map<string, DailyProjectEarning[]>()
  for (const day of weekDays.value) {
    map.set(day.dateKey, dailyExpensesByDate.value[day.dateKey] ?? [])
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

function daysDiff(fromKey: string, toKey: string) {
  const from = parseDateKey(fromKey)
  const to = parseDateKey(toKey)
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / 86400000)
}

async function selectDay(targetDateKey: string) {
  const diff = daysDiff(selectedDateKey.value, targetDateKey)
  if (diff === 0) return
  await board.shiftDate(diff)
}

async function addTaskForDay(dateKey: string) {
  const draft = (dailyDrafts[dateKey] || '').trim()
  if (!draft) return
  try {
    await board.addTaskForDate(dateKey, 'todo', draft)
    dailyDrafts[dateKey] = ''
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось добавить задачу')
  }
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`
}

function loadExpensesFromStorage() {
  try {
    const raw = localStorage.getItem(EXPENSES_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, DailyProjectEarning[]>
    if (!parsed || typeof parsed !== 'object') return
    dailyExpensesByDate.value = parsed
  } catch {
    dailyExpensesByDate.value = {}
  }
}

function persistExpensesToStorage() {
  localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(dailyExpensesByDate.value))
}

function ensureExpensesForDate(dateKey: string) {
  if (!dailyExpensesByDate.value[dateKey]) {
    dailyExpensesByDate.value[dateKey] = []
  }
  return dailyExpensesByDate.value[dateKey]
}

function parseAmount(raw: string) {
  const normalized = raw.replace(/[^\d.,-]/g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

async function addDailyEarningForDay(dateKey: string) {
  try {
    await board.addDailyEarningForDate(dateKey, 'Новый проект')
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось добавить запись заработка')
  }
}

async function saveEarningName(dateKey: string, earning: DailyProjectEarning) {
  const draftKey = `${dateKey}:${earning.id}:name`
  const nextName = (earningDraftNames[draftKey] ?? earning.projectName).trim()
  if (!nextName || nextName === earning.projectName) return
  try {
    await board.updateDailyEarningForDate(dateKey, earning.id, { projectName: nextName })
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось обновить проект')
  }
}

async function saveEarningAmount(dateKey: string, earning: DailyProjectEarning, rawAmount: string) {
  const nextAmount = parseAmount(rawAmount)
  if (nextAmount === earning.amount) return
  try {
    await board.updateDailyEarningForDate(dateKey, earning.id, { amount: nextAmount })
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось обновить сумму')
  }
}

function handleAmountInputChange(dateKey: string, earning: DailyProjectEarning, event: Event) {
  const target = event.target as HTMLInputElement | null
  void saveEarningAmount(dateKey, earning, target?.value || '0')
}

async function removeDailyEarningFromDay(dateKey: string, earningId: string) {
  try {
    await board.removeDailyEarningForDate(dateKey, earningId)
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось удалить запись заработка')
  }
}

function dayExpenseTotal(dateKey: string) {
  const rows = expensesByDay.value.get(dateKey) ?? []
  return rows.reduce((sum, row) => sum + row.amount, 0)
}

function dayNetTotal(dateKey: string) {
  return board.getDayIncomeTotal(dateKey) - dayExpenseTotal(dateKey)
}

function addExpenseForDay(dateKey: string) {
  const rows = ensureExpensesForDate(dateKey)
  rows.push({
    id: crypto.randomUUID(),
    projectName: 'Новая статья',
    amount: 0,
  })
  persistExpensesToStorage()
}

function saveExpenseName(dateKey: string, row: DailyProjectEarning) {
  const key = `${dateKey}:${row.id}:name`
  const nextName = (expenseDraftNames[key] ?? row.projectName).trim()
  if (!nextName) return
  row.projectName = nextName
  persistExpensesToStorage()
}

function saveExpenseAmount(row: DailyProjectEarning, rawAmount: string) {
  row.amount = parseAmount(rawAmount)
  persistExpensesToStorage()
}

function handleExpenseAmountChange(row: DailyProjectEarning, event: Event) {
  const target = event.target as HTMLInputElement | null
  saveExpenseAmount(row, target?.value || '0')
}

function removeExpenseFromDay(dateKey: string, expenseId: string) {
  const rows = ensureExpensesForDate(dateKey)
  dailyExpensesByDate.value[dateKey] = rows.filter((item) => item.id !== expenseId)
  persistExpensesToStorage()
}

async function toggleTask(taskId: string) {
  try {
    await board.toggleTask(taskId)
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Не удалось обновить задачу')
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

onMounted(() => {
  loadExpensesFromStorage()
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
        <div class="days-scroll">
          <article
            v-for="day in weekDays"
            :key="day.dateKey"
            class="day-col"
            :class="{ today: day.isToday }"
            @click="selectDay(day.dateKey)"
          >
            <header class="day-head">
              <h3>{{ day.title }}</h3>
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
                    @click.stop="toggleTask(task.id)"
                  >
                    <span class="check" :class="{ done: task.completed }" />
                    <span class="task-name" :class="{ done: task.completed }">{{ task.title }}</span>
                    <span v-if="scoreLabel(task)" class="score">{{ scoreLabel(task) }}</span>
                  </li>

                  <li class="task-row add-row" @click.stop>
                    <span class="plus">⊕</span>
                    <input
                      v-model="dailyDrafts[day.dateKey]"
                      class="add-input"
                      placeholder="Добавить задачу"
                      @keydown.enter.prevent="addTaskForDay(day.dateKey)"
                    />
                  </li>
                </ul>
              </section>

              <section class="day-income" @click.stop>
                <div class="income-head">
                  <h4>Заработок</h4>
                  <span>{{ formatMoney(board.getDayIncomeTotal(day.dateKey)) }}</span>
                </div>
                <ul class="income-list">
                  <li
                    v-for="earning in earningsByDay.get(day.dateKey) || []"
                    :key="`earning-${earning.id}`"
                    class="income-row"
                  >
                    <input
                      v-model="earningDraftNames[`${day.dateKey}:${earning.id}:name`]"
                      class="income-project"
                      :placeholder="earning.projectName"
                      @focus="earningDraftNames[`${day.dateKey}:${earning.id}:name`] = earning.projectName"
                      @blur="saveEarningName(day.dateKey, earning)"
                      @keydown.enter.prevent="saveEarningName(day.dateKey, earning)"
                    />
                    <input
                      class="income-amount"
                      :value="earning.amount"
                      @change="handleAmountInputChange(day.dateKey, earning, $event)"
                    />
                    <button
                      class="income-remove"
                      type="button"
                      @click.stop="removeDailyEarningFromDay(day.dateKey, earning.id)"
                    >
                      ×
                    </button>
                  </li>
                </ul>
                <button class="income-add" type="button" @click.stop="addDailyEarningForDay(day.dateKey)">
                  + Добавить проект
                </button>

                <div class="expense-head">
                  <h4>Расходы</h4>
                  <span>{{ formatMoney(dayExpenseTotal(day.dateKey)) }}</span>
                </div>
                <ul class="expense-list">
                  <li
                    v-for="expense in expensesByDay.get(day.dateKey) || []"
                    :key="`expense-${expense.id}`"
                    class="income-row"
                  >
                    <input
                      v-model="expenseDraftNames[`${day.dateKey}:${expense.id}:name`]"
                      class="income-project"
                      :placeholder="expense.projectName"
                      @focus="expenseDraftNames[`${day.dateKey}:${expense.id}:name`] = expense.projectName"
                      @blur="saveExpenseName(day.dateKey, expense)"
                      @keydown.enter.prevent="saveExpenseName(day.dateKey, expense)"
                    />
                    <input
                      class="income-amount"
                      :value="expense.amount"
                      @change="handleExpenseAmountChange(expense, $event)"
                    />
                    <button
                      class="income-remove"
                      type="button"
                      @click.stop="removeExpenseFromDay(day.dateKey, expense.id)"
                    >
                      ×
                    </button>
                  </li>
                </ul>
                <button class="income-add" type="button" @click.stop="addExpenseForDay(day.dateKey)">
                  + Добавить расход
                </button>

                <div class="finance-total" :class="{ negative: dayNetTotal(day.dateKey) < 0 }">
                  <span>Итого</span>
                  <strong>{{ formatMoney(dayNetTotal(day.dateKey)) }}</strong>
                </div>
              </section>
            </div>
          </article>
        </div>

        <nav class="nav-controls">
          <button @click="board.shiftDate(-7)">«</button>
          <button @click="board.shiftDate(-1)">‹</button>
          <button @click="board.setToday()">•</button>
          <button @click="board.shiftDate(1)">›</button>
          <button @click="board.shiftDate(7)">»</button>
        </nav>
      </section>

      <button class="logout" :disabled="busy" @click="handleLogout">Выйти</button>

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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-name.done {
  text-decoration: line-through;
  color: #8e99a8;
}

.score {
  margin-left: auto;
  color: #38414b;
  font-size: 12px;
  background: #eff1f5;
  border-radius: 999px;
  padding: 4px 8px;
}

.add-row {
  color: rgba(163, 171, 189, 0.8);
}

.plus {
  font-size: 16px;
}

.add-input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: rgba(163, 171, 189, 0.8);
  font: inherit;
}

.board {
  flex: 1;
  position: relative;
  min-width: 0;
}

.days-scroll {
  display: flex;
  min-width: 0;
  overflow-x: auto;
  min-height: 100vh;
  scrollbar-width: none;
}

.days-scroll::-webkit-scrollbar {
  display: none;
}

.day-col {
  width: 272px;
  min-width: 272px;
  border-right: 1px dashed #e7e7e8;
  padding: 24px 16px 96px;
  cursor: pointer;
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
  font-size: 18px;
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
  overflow: auto;
}

.income-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-left: 2px;
}

.income-head h4 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  font-family: 'Benzin-Semibold', 'Rubik', sans-serif;
}

.income-head span {
  font-size: 13px;
  color: #38414b;
  background: #eff1f5;
  border-radius: 999px;
  padding: 4px 10px;
}

.income-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
}

.expense-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-left: 2px;
  margin-top: 6px;
}

.expense-head h4 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  font-family: 'Benzin-Semibold', 'Rubik', sans-serif;
}

.expense-head span {
  font-size: 13px;
  color: #38414b;
  background: #eff1f5;
  border-radius: 999px;
  padding: 4px 10px;
}

.expense-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: auto;
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

.finance-total.negative strong {
  color: #b73737;
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
  right: 24px;
  top: 24px;
  padding: 0 14px;
  width: auto;
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
