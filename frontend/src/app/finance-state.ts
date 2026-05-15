import { computed, nextTick, reactive, ref, type ComputedRef } from 'vue'

import type { useAppState } from '@/lib/app-state'
import {
  addDays,
  addMonths,
  addYears,
  parseDateKey,
  startOfCalendarMonth,
  startOfCalendarWeek,
  startOfCalendarYear,
  toDateKey,
} from '@/app/date-utils'
import {
  type DisplayEarning,
  isExpenseProject,
  isRemovedProject,
  normalizeProjectName,
  REMOVED_PROJECT_NAMES,
  signedProjectAmount,
} from '@/app/project-model'

type BoardController = ReturnType<typeof useAppState>
type WeekDay = { dateKey: string }

type FinanceStateOptions = {
  board: BoardController
  setError: (message: string) => void
  weekDays: ComputedRef<WeekDay[]>
}

export function useFinanceState(options: FinanceStateOptions) {
  const earningExpanded = reactive<Record<string, boolean>>({})
  const financeTotalExpanded = reactive<Record<string, boolean>>({})
  const editingEarningAmounts = reactive<Record<string, string>>({})
  const skipEarningBlurSave = ref<string | null>(null)

  function formatMoney(value: number) {
    return `${Math.round(value).toLocaleString('ru-RU')} ₽`
  }

  function collectFinanceProjectMeta() {
    const projectMeta = new Map<string, { projectName: string; firstDateKey: string; firstTs: number; hasNonZeroAmount: boolean }>()
    const allEarningsByDate = options.board.getDailyEarningsMap()

    for (const [dateKey, rows] of Object.entries(allEarningsByDate)) {
      const ts = parseDateKey(dateKey).getTime()
      for (const row of rows) {
        const key = normalizeProjectName(row.projectName)
        if (!key || isRemovedProject(row.projectName)) continue
        const existing = projectMeta.get(key)
        if (!existing) {
          projectMeta.set(key, {
            projectName: row.projectName,
            firstDateKey: dateKey,
            firstTs: ts,
            hasNonZeroAmount: row.amount !== 0,
          })
          continue
        }
        existing.hasNonZeroAmount = existing.hasNonZeroAmount || row.amount !== 0
        if (ts < existing.firstTs) {
          existing.projectName = row.projectName
          existing.firstDateKey = dateKey
          existing.firstTs = ts
        }
      }
    }

    return [...projectMeta.entries()]
      .filter(([, meta]) => meta.hasNonZeroAmount)
      .sort((a, b) => {
        const aExpense = isExpenseProject(a[1].projectName)
        const bExpense = isExpenseProject(b[1].projectName)
        if (aExpense !== bExpense) return aExpense ? 1 : -1
        return a[1].firstTs - b[1].firstTs
      })
  }

  const earningsByDay = computed(() => {
    const map = new Map<string, DisplayEarning[]>()
    const sortedProjects = collectFinanceProjectMeta()

    for (const day of options.weekDays.value) {
      const dayTs = parseDateKey(day.dateKey).getTime()
      const rows = options.board.getDayEarnings(day.dateKey)

      const byProject = rows.reduce(
        (acc, row) => {
          const key = normalizeProjectName(row.projectName)
          if (!key || isRemovedProject(row.projectName)) return acc
          if (!acc[key]) {
            acc[key] = {
              amount: 0,
              sourceEntryId: row.id,
              updatedAt: row.updatedAt,
            }
          }
          acc[key].amount += row.amount
          acc[key].updatedAt = row.updatedAt
          return acc
        },
        {} as Record<string, { amount: number; sourceEntryId: string | null; updatedAt: string | null }>,
      )

      const visible = sortedProjects
        .filter(([, meta]) => meta.firstTs <= dayTs)
        .map(([projectKey, meta]) => ({
          id: `${meta.firstDateKey}:${projectKey}`,
          projectName: meta.projectName,
          amount: byProject[projectKey]?.amount ?? 0,
          sourceEntryId: byProject[projectKey]?.sourceEntryId ?? null,
          updatedAt: byProject[projectKey]?.updatedAt ?? null,
        }))

      map.set(day.dateKey, visible)
    }

    return map
  })

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
    return rows.reduce((sum, earning) => sum + signedProjectAmount(earning.projectName, earning.amount), 0)
  }

  function sumNetByRange(start: Date, end: Date) {
    const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
    const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
    const allEarningsByDate = options.board.getDailyEarningsMap()
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

  function isEarningAmountEditing(dateKey: string, earningId: string) {
    const key = earningAmountEditKey(dateKey, earningId)
    return typeof editingEarningAmounts[key] === 'string'
  }

  async function setDailyProjectAmount(dateKey: string, earning: DisplayEarning, amount: number) {
    if (earning.sourceEntryId) {
      await options.board.updateDailyEarningForDate(dateKey, earning.sourceEntryId, { amount })
      return
    }

    const fallback = options.board
      .getDayEarnings(dateKey)
      .find((item) => normalizeProjectName(item.projectName) === normalizeProjectName(earning.projectName))

    if (fallback) {
      await options.board.updateDailyEarningForDate(dateKey, fallback.id, { amount })
      return
    }

    await options.board.addDailyEarningForDate(dateKey, earning.projectName, amount)
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
      options.setError(error instanceof Error ? error.message : 'Не удалось обновить сумму проекта')
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

  function incomeByProjectOnDate(dateKey: string, projectName: string) {
    const key = normalizeProjectName(projectName)
    if (!key || REMOVED_PROJECT_NAMES.has(key)) return 0
    const amount = options.board
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

  return {
    cancelEarningAmountEdit,
    collectFinanceProjectMeta,
    dayIncomeTotal,
    deltaByPeriod,
    deltaPercentByPeriod,
    earningAccordionKey,
    earningAmountEditKey,
    earningExpanded,
    earningsByDay,
    editingEarningAmounts,
    financeTotalExpanded,
    formatDelta,
    formatMoney,
    formatPercent,
    formatSignedMoney,
    handleEarningAmountBlur,
    handleEarningAmountEnter,
    handleEarningAmountEscape,
    incomeByProjectOnDate,
    isEarningAmountEditing,
    isEarningExpanded,
    isFinanceTotalExpanded,
    parseAmount,
    periodNetByDate,
    previousByPeriod,
    saveEarningAmountEdit,
    setDailyProjectAmount,
    skipEarningBlurSave,
    startEarningAmountEdit,
    sumNetByRange,
    toggleEarningExpanded,
    toggleFinanceTotalExpanded,
  }
}
