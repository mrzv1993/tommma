<script setup lang="ts">
import {
  Book,
  ChevronDown,
  Ellipsis,
  FileText,
  Globe,
  GraduationCap,
  Inbox,
  Mic,
  SquarePen,
  Trash2 as Trash,
  TvMinimalPlay,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, type NoteStateItem, type NotesState, type SourceType } from '@/lib/api'

type SourceMeta = {
  type: SourceType
  label: string
  icon: typeof Book
}

type NoteItem = {
  id: string
  text: string
  createdAt: number
  updatedAt: number
  sourceType?: SourceType
  sourceName?: string
  sourceUrl?: string
}

const SOURCE_TYPES: SourceMeta[] = [
  { type: 'book', label: 'Книга', icon: Book },
  { type: 'article', label: 'Статья', icon: FileText },
  { type: 'video', label: 'Видео', icon: TvMinimalPlay },
  { type: 'course', label: 'Курс', icon: GraduationCap },
  { type: 'podcast', label: 'Подкаст', icon: Mic },
  { type: 'social', label: 'Соцсети', icon: Globe },
  { type: 'other', label: 'Другое', icon: Inbox },
]

const STORAGE_KEY = 'tommma.notes.v1'
const DELETED_NOTES_STORAGE_KEY = 'tommma.notes.deleted.v1'
const NOTES_SIDEBAR_WIDTH_STORAGE_KEY = 'tommma.notes.sidebar.width.v1'
const NOTES_SIDEBAR_MIN_WIDTH = 220
const NOTES_SIDEBAR_MAX_WIDTH = 520

function normalizeNotes(raw: unknown): NoteItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const item = entry as Partial<NoteItem>
      if (typeof item.id !== 'string' || typeof item.text !== 'string') return null
      const sourceType = SOURCE_TYPES.some((source) => source.type === item.sourceType) ? item.sourceType : undefined
      const sourceName = typeof item.sourceName === 'string' ? item.sourceName.trim() : ''
      const sourceUrl = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : ''
      const note: NoteItem = {
        id: item.id,
        text: item.text,
        createdAt: Number(item.createdAt || Date.now()),
        updatedAt: Number(item.updatedAt || Date.now()),
      }
      if (sourceType) note.sourceType = sourceType
      if (sourceName) note.sourceName = sourceName
      if (sourceUrl) note.sourceUrl = sourceUrl
      return note
    })
    .filter((item): item is NoteItem => item !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function loadNotes(): NoteItem[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as unknown
    return normalizeNotes(raw)
  } catch {
    return []
  }
}

function normalizeDeletedNoteIds(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, number> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue
    const deletedAt = Number(value)
    if (Number.isFinite(deletedAt) && deletedAt >= 0) {
      result[id] = deletedAt
    }
  }
  return result
}

function loadDeletedNoteIds(): Record<string, number> {
  try {
    return normalizeDeletedNoteIds(JSON.parse(window.localStorage.getItem(DELETED_NOTES_STORAGE_KEY) || '{}'))
  } catch {
    return {}
  }
}

const notes = ref<NoteItem[]>(loadNotes())
const deletedNoteIds = ref<Record<string, number>>(loadDeletedNoteIds())
const query = ref('')
const draft = ref('')
const tagsDraft = ref('')
const sourceTypeDraft = ref<SourceType>('book')
const sourceNameDraft = ref('')
const sourceUrlDraft = ref('')
const sourceSelectOpen = ref(false)
const editingId = ref('')
const editingDraft = ref('')
const openMenuId = ref('')
const nowMs = ref(Date.now())
const notesListRef = ref<HTMLElement | null>(null)
const sourceSelectRef = ref<HTMLElement | null>(null)
const notesSidebarWidth = ref(240)

const NOTES_GAP = 8
const NOTE_MIN_WIDTH = 360
const NOTE_MAX_WIDTH = 420
let notesLayoutRaf: number | null = null
let notesResizeObserver: ResizeObserver | null = null
let relativeTimeInterval: number | null = null
let notesSyncInterval: number | null = null
let notesSyncRetryTimeout: number | null = null
let notesSyncInFlight = false
let notesSyncPendingAfterFlight = false
let notesSyncDirty = false
let notesHydratingFromServer = false

type CounterItem = {
  key: string
  count: number
}

type SourceCounterItem = {
  key: string
  label: string
  type: SourceType
  count: number
}

function persistNotes() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.value))
  window.localStorage.setItem(DELETED_NOTES_STORAGE_KEY, JSON.stringify(deletedNoteIds.value))
}

function loadNotesSidebarWidth() {
  const raw = Number(window.localStorage.getItem(NOTES_SIDEBAR_WIDTH_STORAGE_KEY))
  if (!Number.isFinite(raw)) return
  notesSidebarWidth.value = Math.max(NOTES_SIDEBAR_MIN_WIDTH, Math.min(NOTES_SIDEBAR_MAX_WIDTH, raw))
}

function saveNotesSidebarWidth() {
  window.localStorage.setItem(NOTES_SIDEBAR_WIDTH_STORAGE_KEY, String(notesSidebarWidth.value))
  markNotesStateDirty()
}

function persistNotesStateToLocalCache() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.value))
  window.localStorage.setItem(DELETED_NOTES_STORAGE_KEY, JSON.stringify(deletedNoteIds.value))
  window.localStorage.setItem(NOTES_SIDEBAR_WIDTH_STORAGE_KEY, String(notesSidebarWidth.value))
}

function buildNotesStatePayload() {
  const payloadNotes: NoteStateItem[] = notes.value.map((note) => ({
    id: note.id,
    text: note.text,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    sourceType: note.sourceType,
    sourceName: note.sourceName,
    sourceUrl: note.sourceUrl,
  }))
  return {
    notes: payloadNotes,
    deletedNoteIds: deletedNoteIds.value,
    sidebarWidth: notesSidebarWidth.value,
  }
}

function applyNotesState(state: NotesState) {
  notesHydratingFromServer = true
  try {
    const deleted = normalizeDeletedNoteIds(state.deletedNoteIds || {})
    deletedNoteIds.value = deleted
    notes.value = normalizeNotes(state.notes).filter((note) => {
      const deletedAt = deleted[note.id]
      return !deletedAt || deletedAt < note.updatedAt
    })
    const nextWidth = Number(state.sidebarWidth)
    if (Number.isFinite(nextWidth)) {
      notesSidebarWidth.value = Math.max(NOTES_SIDEBAR_MIN_WIDTH, Math.min(NOTES_SIDEBAR_MAX_WIDTH, nextWidth))
    }
    persistNotesStateToLocalCache()
  } finally {
    notesHydratingFromServer = false
  }
}

function hasLocalNotesData() {
  return notes.value.length > 0 || Object.keys(deletedNoteIds.value).length > 0
}

function isNotesStateEffectivelyEmpty(state: NotesState) {
  return (
    (!Array.isArray(state.notes) || state.notes.length === 0) &&
    Object.keys(state.deletedNoteIds || {}).length === 0
  )
}

function noteSignature(note: NoteItem) {
  return JSON.stringify({
    id: note.id,
    text: note.text,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    sourceType: note.sourceType || '',
    sourceName: note.sourceName || '',
    sourceUrl: note.sourceUrl || '',
  })
}

function areNoteListsEqual(left: NoteItem[], right: NoteItem[]) {
  if (left.length !== right.length) return false
  const byId = new Map(right.map((note) => [note.id, noteSignature(note)]))
  for (const note of left) {
    if (byId.get(note.id) !== noteSignature(note)) return false
  }
  return true
}

function mergeDeletedNoteIds(
  serverDeletedNoteIds: Record<string, number>,
  localDeletedNoteIds: Record<string, number>,
) {
  const merged = { ...serverDeletedNoteIds }
  for (const [id, deletedAt] of Object.entries(localDeletedNoteIds)) {
    merged[id] = Math.max(merged[id] || 0, deletedAt)
  }
  return merged
}

function mergeNotesByRecency(
  serverNotes: NoteItem[],
  localNotes: NoteItem[],
  serverDeletedNoteIds: Record<string, number>,
  localDeletedNoteIds: Record<string, number>,
) {
  const mergedDeletedNoteIds = mergeDeletedNoteIds(serverDeletedNoteIds, localDeletedNoteIds)
  const mergedById = new Map<string, NoteItem>()
  for (const note of serverNotes) {
    mergedById.set(note.id, { ...note })
  }
  for (const note of localNotes) {
    const existing = mergedById.get(note.id)
    if (!existing || note.updatedAt > existing.updatedAt) {
      mergedById.set(note.id, { ...note })
    }
  }
  return [...mergedById.values()]
    .filter((note) => {
      const deletedAt = mergedDeletedNoteIds[note.id]
      return !deletedAt || deletedAt < note.updatedAt
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function areDeletedNoteIdsEqual(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => left[key] === right[key])
}

function scheduleNotesStateSync(delayMs = 0) {
  if (notesSyncRetryTimeout) {
    window.clearTimeout(notesSyncRetryTimeout)
  }
  notesSyncRetryTimeout = window.setTimeout(() => {
    notesSyncRetryTimeout = null
    void syncNotesState()
  }, delayMs)
}

function markNotesStateDirty() {
  if (notesHydratingFromServer) return
  notesSyncDirty = true
  scheduleNotesStateSync(250)
}

function resetNotesSyncState() {
  notesSyncDirty = false
  notesSyncInFlight = false
  notesSyncPendingAfterFlight = false
  if (notesSyncRetryTimeout) {
    window.clearTimeout(notesSyncRetryTimeout)
    notesSyncRetryTimeout = null
  }
}

async function syncNotesState() {
  if (notesHydratingFromServer) return
  if (notesSyncInFlight) {
    notesSyncPendingAfterFlight = true
    return
  }

  notesSyncInFlight = true
  try {
    if (notesSyncDirty) {
      const serverResult = await api.getNotesState()
      const serverDeletedNoteIds = normalizeDeletedNoteIds(serverResult.notesState.deletedNoteIds || {})
      const mergedDeletedNoteIds = mergeDeletedNoteIds(serverDeletedNoteIds, deletedNoteIds.value)
      const mergedNotes = mergeNotesByRecency(
        normalizeNotes(serverResult.notesState.notes),
        notes.value,
        serverDeletedNoteIds,
        deletedNoteIds.value,
      )
      if (
        !areNoteListsEqual(notes.value, mergedNotes) ||
        !areDeletedNoteIdsEqual(deletedNoteIds.value, mergedDeletedNoteIds)
      ) {
        applyNotesState({
          notes: mergedNotes,
          deletedNoteIds: mergedDeletedNoteIds,
          sidebarWidth: notesSidebarWidth.value,
        })
      }
      const result = await api.putNotesState(buildNotesStatePayload())
      applyNotesState(result.notesState)
      notesSyncDirty = false
    } else {
      const result = await api.getNotesState()
      if (isNotesStateEffectivelyEmpty(result.notesState) && hasLocalNotesData()) {
        notesSyncDirty = true
        scheduleNotesStateSync(0)
        return
      }
      const serverNotes = normalizeNotes(result.notesState.notes)
      const serverDeletedNoteIds = normalizeDeletedNoteIds(result.notesState.deletedNoteIds || {})
      const mergedDeletedNoteIds = mergeDeletedNoteIds(serverDeletedNoteIds, deletedNoteIds.value)
      const mergedNotes = mergeNotesByRecency(
        serverNotes,
        notes.value,
        serverDeletedNoteIds,
        deletedNoteIds.value,
      )
      if (
        !areNoteListsEqual(serverNotes, mergedNotes) ||
        !areDeletedNoteIdsEqual(serverDeletedNoteIds, mergedDeletedNoteIds)
      ) {
        applyNotesState({
          notes: mergedNotes,
          deletedNoteIds: mergedDeletedNoteIds,
          sidebarWidth: result.notesState.sidebarWidth,
        })
        notesSyncDirty = true
        scheduleNotesStateSync(0)
        return
      }
      applyNotesState(result.notesState)
    }
  } catch {
    scheduleNotesStateSync(notesSyncDirty ? 2000 : 5000)
  } finally {
    notesSyncInFlight = false
    if (notesSyncPendingAfterFlight) {
      notesSyncPendingAfterFlight = false
      scheduleNotesStateSync(0)
    }
  }
}

async function loadNotesStateFromServer() {
  try {
    const result = await api.getNotesState()
    if (!isNotesStateEffectivelyEmpty(result.notesState)) {
      const serverNotes = normalizeNotes(result.notesState.notes)
      const serverDeletedNoteIds = normalizeDeletedNoteIds(result.notesState.deletedNoteIds || {})
      const mergedDeletedNoteIds = mergeDeletedNoteIds(serverDeletedNoteIds, deletedNoteIds.value)
      const mergedNotes = mergeNotesByRecency(
        serverNotes,
        notes.value,
        serverDeletedNoteIds,
        deletedNoteIds.value,
      )
      applyNotesState({
        notes: mergedNotes,
        deletedNoteIds: mergedDeletedNoteIds,
        sidebarWidth: result.notesState.sidebarWidth,
      })
      notesSyncDirty =
        !areNoteListsEqual(serverNotes, mergedNotes) ||
        !areDeletedNoteIdsEqual(serverDeletedNoteIds, mergedDeletedNoteIds)
      if (notesSyncDirty) scheduleNotesStateSync(0)
      return
    }
  } catch {
    scheduleNotesStateSync(2000)
  }

  if (hasLocalNotesData()) {
    markNotesStateDirty()
  }
}

function syncNotesOnForeground() {
  if (document.visibilityState === 'hidden') return
  void syncNotesState()
}

function startNotesAutoSync() {
  if (notesSyncInterval) return
  notesSyncInterval = window.setInterval(() => {
    void syncNotesState()
  }, 10000)
}

function stopNotesAutoSync() {
  if (!notesSyncInterval) return
  window.clearInterval(notesSyncInterval)
  notesSyncInterval = null
}

const visibleNotes = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return notes.value
  return notes.value.filter((note) => note.text.toLowerCase().includes(q))
})

const tagCounters = computed<CounterItem[]>(() => {
  const map = new Map<string, CounterItem>()
  for (const note of notes.value) {
    for (const tag of noteHashtags(note.text)) {
      const normalized = tag.toLowerCase()
      const existing = map.get(normalized)
      if (existing) {
        existing.count += 1
      } else {
        map.set(normalized, { key: tag, count: 1 })
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ru'))
})

const sourceCounters = computed<SourceCounterItem[]>(() => {
  const map = new Map<string, SourceCounterItem>()
  for (const note of notes.value) {
    const sourceName = note.sourceName?.trim()
    const sourceType = note.sourceType
    if (!sourceName || !sourceType) continue
    const key = `${sourceType}:${sourceName.toLowerCase()}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
    } else {
      map.set(key, { key, label: sourceName, type: sourceType, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'))
})

function createNote() {
  const text = draft.value.trim()
  if (!text) return
  const tagWords = tagsDraft.value
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^#+/u, '').replace(/[^\p{L}\p{N}_-]/gu, '').trim())
    .filter(Boolean)
  const tagsFromInput = tagWords.map((word) => `#${word}`)
  const tagsFromText = noteHashtags(text)
  const knownTags = new Set(tagsFromText.map((tag) => tag.toLowerCase()))
  const appendedTags = tagsFromInput.filter((tag) => {
    const key = tag.toLowerCase()
    if (knownTags.has(key)) return false
    knownTags.add(key)
    return true
  })
  const finalText = appendedTags.length ? `${text} ${appendedTags.join(' ')}` : text
  const now = Date.now()
  notes.value.unshift({
    id: crypto.randomUUID(),
    text: finalText,
    createdAt: now,
    updatedAt: now,
    sourceType: sourceNameDraft.value.trim() ? sourceTypeDraft.value : undefined,
    sourceName: sourceNameDraft.value.trim() || undefined,
    sourceUrl: sourceUrlDraft.value.trim() || undefined,
  })
  draft.value = ''
  tagsDraft.value = ''
  sourceTypeDraft.value = 'book'
  sourceNameDraft.value = ''
  sourceUrlDraft.value = ''
  persistNotes()
  markNotesStateDirty()
}

function startEdit(note: NoteItem) {
  editingId.value = note.id
  editingDraft.value = note.text
}

function cancelEdit() {
  editingId.value = ''
  editingDraft.value = ''
}

function saveEdit() {
  const id = editingId.value
  if (!id) return
  const text = editingDraft.value.trim()
  if (!text) return
  const note = notes.value.find((item) => item.id === id)
  if (!note) return
  note.text = text
  note.updatedAt = Date.now()
  notes.value.sort((a, b) => b.updatedAt - a.updatedAt)
  persistNotes()
  markNotesStateDirty()
  cancelEdit()
}

function removeNote(noteId: string) {
  deletedNoteIds.value[noteId] = Date.now()
  notes.value = notes.value.filter((item) => item.id !== noteId)
  if (openMenuId.value === noteId) openMenuId.value = ''
  persistNotes()
  markNotesStateDirty()
}

function toggleNoteMenu(noteId: string) {
  openMenuId.value = openMenuId.value === noteId ? '' : noteId
}

function closeNoteMenu() {
  openMenuId.value = ''
}

function setSourceType(type: SourceType) {
  sourceTypeDraft.value = type
  sourceSelectOpen.value = false
}

function toggleSourceSelect() {
  sourceSelectOpen.value = !sourceSelectOpen.value
}

function closeFloatingMenus() {
  openMenuId.value = ''
  sourceSelectOpen.value = false
}

function sourceByType(type?: SourceType) {
  if (!type) return null
  return SOURCE_TYPES.find((source) => source.type === type) ?? null
}

function normalizedSourceUrl(url?: string) {
  if (!url) return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function startNotesSidebarResize(event: MouseEvent) {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = notesSidebarWidth.value

  const handleMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX
    const next = startWidth + delta
    notesSidebarWidth.value = Math.max(NOTES_SIDEBAR_MIN_WIDTH, Math.min(NOTES_SIDEBAR_MAX_WIDTH, next))
    scheduleNotesLayout()
  }

  const handleUp = () => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
    saveNotesSidebarWidth()
  }

  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}

function scheduleNotesLayout() {
  if (notesLayoutRaf !== null) window.cancelAnimationFrame(notesLayoutRaf)
  notesLayoutRaf = window.requestAnimationFrame(() => {
    notesLayoutRaf = null
    applyNotesLayout()
  })
}

function applyNotesLayout() {
  const list = notesListRef.value
  if (!list) return
  const cards = Array.from(list.querySelectorAll<HTMLElement>(':scope > .note-card'))
  if (!cards.length) {
    list.style.height = '0px'
    return
  }

  const containerWidth = list.clientWidth
  if (containerWidth <= 0) return

  const maxColumns = Math.max(1, Math.floor((containerWidth + NOTES_GAP) / (NOTE_MIN_WIDTH + NOTES_GAP)))
  let columns = maxColumns
  let cardWidth = (containerWidth - (columns - 1) * NOTES_GAP) / columns

  while (columns > 1 && cardWidth > NOTE_MAX_WIDTH) {
    columns += 1
    cardWidth = (containerWidth - (columns - 1) * NOTES_GAP) / columns
    if (cardWidth < NOTE_MIN_WIDTH) {
      columns -= 1
      cardWidth = (containerWidth - (columns - 1) * NOTES_GAP) / columns
      break
    }
  }

  cardWidth = Math.min(NOTE_MAX_WIDTH, Math.max(NOTE_MIN_WIDTH, cardWidth))
  if (columns === 1) {
    cardWidth = Math.min(NOTE_MAX_WIDTH, Math.max(Math.min(containerWidth, NOTE_MIN_WIDTH), containerWidth))
  }

  const columnHeights = Array.from({ length: columns }, () => 0)

  cards.forEach((card) => {
    card.style.position = 'absolute'
    card.style.width = `${cardWidth}px`
    card.style.minWidth = `${cardWidth}px`
    card.style.maxWidth = `${cardWidth}px`

    let targetColumn = 0
    for (let i = 1; i < columnHeights.length; i += 1) {
      if (columnHeights[i] < columnHeights[targetColumn]) targetColumn = i
    }

    const left = targetColumn * (cardWidth + NOTES_GAP)
    const top = columnHeights[targetColumn]
    card.style.left = `${left}px`
    card.style.top = `${top}px`
    columnHeights[targetColumn] += card.offsetHeight + NOTES_GAP
  })

  const contentHeight = Math.max(...columnHeights, 0)
  list.style.height = `${Math.max(0, contentHeight - NOTES_GAP)}px`
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateTooltip(ts: number) {
  const date = new Date(ts)
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  const day = pad2(date.getDate())
  const month = pad2(date.getMonth() + 1)
  const year = pad2(date.getFullYear() % 100)
  return `${hours}:${minutes} ${day}.${month}.${year}`
}

function formatRelativeDate(ts: number) {
  const diffMs = Math.max(0, nowMs.value - ts)
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (diffMs < minute) return 'сейчас'
  if (diffMs < 2 * minute) return 'минуту назад'
  if (diffMs < hour) return 'несколько минут назад'
  if (diffMs < 2 * hour) return 'час назад'
  if (diffMs < day) return 'несколько часов назад'
  if (diffMs < 2 * day) return 'вчера'
  if (diffMs < week) return 'несколько дней назад'
  if (diffMs < 2 * week) return 'неделю назад'
  if (diffMs < month) return 'несколько недель назад'
  if (diffMs < 2 * month) return 'месяц назад'
  if (diffMs < year) return 'несколько месяцев назад'
  if (diffMs < 2 * year) return 'год назад'
  if (diffMs < 3 * year) return 'два года назад'
  if (diffMs < 4 * year) return 'три года назад'
  return 'более трёх лет назад'
}

function noteHashtags(text: string) {
  const matches = text.match(/(^|\s)(#[\p{L}\p{N}_-]+)/gu) ?? []
  const tags = matches.map((token) => token.trim())
  return [...new Set(tags)]
}

function noteTextWithoutHashtags(text: string) {
  return text
    .replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

onMounted(async () => {
  loadNotesSidebarWidth()
  await loadNotesStateFromServer()
  await nextTick()
  scheduleNotesLayout()
  notesResizeObserver = new ResizeObserver(() => {
    scheduleNotesLayout()
  })
  if (notesListRef.value) notesResizeObserver.observe(notesListRef.value)
  window.addEventListener('resize', scheduleNotesLayout)
  document.addEventListener('click', handleDocumentClick)
  window.addEventListener('focus', syncNotesOnForeground)
  document.addEventListener('visibilitychange', syncNotesOnForeground)
  relativeTimeInterval = window.setInterval(() => {
    nowMs.value = Date.now()
    scheduleNotesLayout()
  }, 60_000)
  startNotesAutoSync()
})

onBeforeUnmount(() => {
  if (notesLayoutRaf !== null) window.cancelAnimationFrame(notesLayoutRaf)
  notesResizeObserver?.disconnect()
  notesResizeObserver = null
  window.removeEventListener('resize', scheduleNotesLayout)
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('focus', syncNotesOnForeground)
  document.removeEventListener('visibilitychange', syncNotesOnForeground)
  if (relativeTimeInterval !== null) {
    window.clearInterval(relativeTimeInterval)
    relativeTimeInterval = null
  }
  stopNotesAutoSync()
  resetNotesSyncState()
})

watch([visibleNotes, draft, editingId, editingDraft, openMenuId, nowMs, notesSidebarWidth], async () => {
  await nextTick()
  scheduleNotesLayout()
}, { deep: true })

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (sourceSelectRef.value?.contains(target)) return
  sourceSelectOpen.value = false
}
</script>

<template>
  <section class="notes-board">
    <aside class="notes-sidebar" :style="{ width: `${notesSidebarWidth}px` }">
      <div class="notes-sidebar-block">
        <h3 class="notes-sidebar-title">Теги</h3>
        <ul v-if="tagCounters.length" class="notes-sidebar-list">
          <li v-for="tag in tagCounters" :key="tag.key" class="notes-sidebar-item">
            <span class="notes-sidebar-tag">{{ tag.key }}</span>
            <span class="notes-sidebar-count">{{ tag.count }}</span>
          </li>
        </ul>
        <p v-else class="notes-sidebar-empty">Пока нет тегов</p>
      </div>

      <div class="notes-sidebar-block">
        <h3 class="notes-sidebar-title">Источники</h3>
        <ul v-if="sourceCounters.length" class="notes-sidebar-list">
          <li v-for="source in sourceCounters" :key="source.key" class="notes-sidebar-item">
            <span class="notes-sidebar-source" :class="`source-${source.type}`">
              <component :is="sourceByType(source.type)?.icon" :size="12" />
              <span>{{ source.label }}</span>
            </span>
            <span class="notes-sidebar-count">{{ source.count }}</span>
          </li>
        </ul>
        <p v-else class="notes-sidebar-empty">Пока нет источников</p>
      </div>
      <div class="notes-sidebar-resize-handle" @mousedown="startNotesSidebarResize" />
    </aside>

    <section class="notes-main">
      <header class="notes-toolbar">
        <h2>Заметки</h2>
        <input v-model="query" class="notes-search" placeholder="Поиск" />
      </header>

      <ul ref="notesListRef" class="notes-list" @click="closeFloatingMenus">
        <li class="note-card note-card-create">
        <textarea
          v-model="draft"
          class="notes-input"
          rows="3"
          placeholder="Напишите заметку..."
          @keydown.meta.enter.prevent="createNote"
          @keydown.ctrl.enter.prevent="createNote"
        />
        <input
          v-model="tagsDraft"
          class="notes-tags-input"
          type="text"
          placeholder="Теги через пробел"
          @keydown.enter.prevent="createNote"
        />
        <div class="notes-source-row">
          <div ref="sourceSelectRef" class="notes-source-select">
            <button type="button" class="notes-source-select-trigger" @click.stop="toggleSourceSelect">
              <component :is="sourceByType(sourceTypeDraft)?.icon" :size="14" />
              <span>{{ sourceByType(sourceTypeDraft)?.label }}</span>
              <ChevronDown :size="14" class="notes-source-select-chevron" />
            </button>
            <div v-if="sourceSelectOpen" class="notes-source-select-content" @click.stop>
              <button
                v-for="source in SOURCE_TYPES"
                :key="source.type"
                type="button"
                class="notes-source-select-item"
                :class="{ active: source.type === sourceTypeDraft }"
                @click.stop="setSourceType(source.type)"
              >
                <component :is="source.icon" :size="14" />
                <span>{{ source.label }}</span>
              </button>
            </div>
          </div>
          <input
            v-model="sourceNameDraft"
            class="notes-source-input"
            type="text"
            placeholder="Название источника"
            @keydown.enter.prevent="createNote"
          />
        </div>
        <input
          v-model="sourceUrlDraft"
          class="notes-source-url-input"
          type="text"
          placeholder="Ссылка на источник"
          @keydown.enter.prevent="createNote"
        />
        <button type="button" class="notes-btn" @click="createNote">Добавить</button>
        </li>
        <li v-for="note in visibleNotes" :key="note.id" class="note-card">
        <div class="note-meta-row">
          <div class="note-meta" tabindex="0">
            {{ formatRelativeDate(note.updatedAt) }}
            <span class="note-meta-tooltip">{{ formatDateTooltip(note.updatedAt) }}</span>
          </div>
          <div class="note-menu-wrap">
            <button
              type="button"
              class="note-menu-trigger"
              aria-label="Открыть меню заметки"
              title="Меню"
              @click.stop="toggleNoteMenu(note.id)"
            >
              <Ellipsis :size="16" />
            </button>
            <div v-if="openMenuId === note.id" class="note-menu" @click.stop>
              <button type="button" class="note-menu-item" @click="startEdit(note); closeNoteMenu()">
                <SquarePen :size="14" />
                <span>Редактировать</span>
              </button>
              <button type="button" class="note-menu-item danger" @click="removeNote(note.id); closeNoteMenu()">
                <Trash :size="14" />
                <span>Удалить</span>
              </button>
            </div>
          </div>
        </div>
        <textarea
          v-if="editingId === note.id"
          v-model="editingDraft"
          class="note-edit"
          rows="3"
          @keydown.enter.meta.prevent="saveEdit"
          @keydown.enter.ctrl.prevent="saveEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="saveEdit"
        />
        <template v-else>
          <div v-if="noteHashtags(note.text).length" class="note-tags">
            <span v-for="tag in noteHashtags(note.text)" :key="`${note.id}-${tag}`" class="note-tag">{{ tag }}</span>
          </div>
          <p class="note-text" @dblclick="startEdit(note)">{{ noteTextWithoutHashtags(note.text) }}</p>
        </template>
        <div v-if="editingId === note.id" class="note-actions">
          <button v-if="editingId === note.id" type="button" class="note-action" @click="cancelEdit">Отмена</button>
          <button v-if="editingId === note.id" type="button" class="note-action" @click="saveEdit">Сохранить</button>
        </div>
        <div v-else-if="note.sourceName && sourceByType(note.sourceType)" class="note-source">
          <a
            v-if="normalizedSourceUrl(note.sourceUrl)"
            class="note-source-type"
            :class="`source-${note.sourceType}`"
            :href="normalizedSourceUrl(note.sourceUrl)"
            target="_blank"
            rel="noopener noreferrer"
          >
            <component :is="sourceByType(note.sourceType)?.icon" :size="12" />
            <span>{{ note.sourceName }}</span>
          </a>
          <span v-else class="note-source-type" :class="`source-${note.sourceType}`">
            <component :is="sourceByType(note.sourceType)?.icon" :size="12" />
            <span>{{ note.sourceName }}</span>
          </span>
        </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.notes-board {
  min-height: calc(100vh - 32px);
  display: flex;
  align-items: stretch;
  gap: 0;
}

.notes-sidebar {
  position: relative;
  background: #eff1f5;
  padding: 16px 18px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  overflow-x: hidden;
}

.notes-sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
  cursor: ew-resize;
  z-index: 4;
}

.notes-sidebar-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notes-sidebar-title {
  margin: 0;
  font-size: 15px;
  color: #2c3a4d;
}

.notes-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notes-sidebar-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notes-sidebar-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #e6eefb;
  color: #2a4a78;
  font-size: 12px;
  font-weight: 600;
}

.notes-sidebar-source {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.notes-sidebar-count {
  min-width: 24px;
  height: 22px;
  border-radius: 999px;
  background: #e4e8ef;
  color: #3c4b5e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.notes-sidebar-empty {
  margin: 0;
  color: #7a8799;
  font-size: 13px;
}

.notes-main {
  flex: 1;
  min-width: 0;
  background: #eff1f5;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.notes-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.notes-toolbar h2 {
  margin: 0;
  font-size: 24px;
  color: #1f2a36;
}

.notes-search {
  width: 180px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #c8d3e2;
  padding: 0 10px;
  font: inherit;
}

.notes-input,
.note-edit {
  width: 100%;
  border-radius: 10px;
  border: 1px solid #c8d3e2;
  padding: 10px;
  font: inherit;
  resize: vertical;
  background: #ffffff;
}

.notes-tags-input {
  width: 100%;
  height: 38px;
  border-radius: 10px;
  border: 1px solid #c8d3e2;
  padding: 0 10px;
  font: inherit;
  background: #ffffff;
}

.notes-source-row {
  display: grid;
  grid-template-columns: 146px minmax(0, 1fr);
  gap: 8px;
}

.notes-source-select,
.notes-source-input {
  height: 38px;
  border-radius: 10px;
  border: 1px solid #c8d3e2;
  background: #ffffff;
  font: inherit;
}

.notes-source-select {
  position: relative;
}

.notes-source-select-trigger {
  width: 100%;
  height: 38px;
  border: 1px solid #c8d3e2;
  border-radius: 10px;
  background: #ffffff;
  color: #263445;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
}

.notes-source-select-trigger > span {
  margin-right: auto;
}

.notes-source-select-chevron {
  color: #7e8ca0;
}

.notes-source-select-content {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  width: 100%;
  border: 1px solid #d7deea;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(23, 34, 49, 0.14);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.notes-source-select-item {
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #2a394d;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
  text-align: left;
}

.notes-source-select-item:hover,
.notes-source-select-item.active {
  background: #eaf1ff;
}

.notes-source-input {
  padding: 0 10px;
}

.notes-source-url-input {
  width: 100%;
  height: 38px;
  border-radius: 10px;
  border: 1px solid #c8d3e2;
  background: #ffffff;
  font: inherit;
  padding: 0 10px;
}

.notes-btn,
.note-action {
  border: 0;
  border-radius: 8px;
  min-height: 32px;
  padding: 0 10px;
  background: #d6e4fb;
  color: #1f3b67;
  cursor: pointer;
}

.notes-list {
  list-style: none;
  margin: 0;
  padding: 0;
  position: relative;
  width: 100%;
}

.note-card {
  background: #ffffff;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.note-card-create {
  gap: 10px;
}

.note-meta {
  color: #7e8ca0;
  font-size: 12px;
  position: relative;
  display: inline-flex;
  align-items: center;
  width: fit-content;
  cursor: help;
  outline: none;
}

.note-meta-tooltip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 8;
  border: 1px solid #d7deea;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 10px 18px rgba(23, 34, 49, 0.12);
  color: #334155;
  font-size: 12px;
  line-height: 1;
  padding: 7px 8px;
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transform: translateY(4px);
  transition: opacity 0.12s ease, transform 0.12s ease, visibility 0.12s ease;
  pointer-events: none;
}

.note-meta:hover .note-meta-tooltip,
.note-meta:focus-visible .note-meta-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.note-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.note-menu-wrap {
  position: relative;
}

.note-menu-trigger {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #72839a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.note-menu-trigger:hover {
  background: #e8edf6;
}

.note-menu {
  position: absolute;
  top: 28px;
  right: 0;
  z-index: 10;
  min-width: 170px;
  border: 1px solid #d7deea;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 12px 24px rgba(23, 34, 49, 0.14);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.note-menu-item {
  border: 0;
  border-radius: 8px;
  min-height: 30px;
  padding: 0 8px;
  background: transparent;
  color: #2a394d;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  text-align: left;
}

.note-menu-item:hover {
  background: #eaf1ff;
}

.note-menu-item.danger {
  color: #b63e67;
}

.note-menu-item.danger:hover {
  background: #fbe7ef;
}

.note-text {
  margin: 0;
  white-space: pre-wrap;
  color: #263445;
}

.note-source {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  flex-wrap: wrap;
}

.note-source-type {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

.source-book {
  background: #d8ebff;
  color: #245287;
}

.source-article {
  background: #e4edff;
  color: #355492;
}

.source-video {
  background: #ffe2e8;
  color: #9a3758;
}

.source-course {
  background: #e2f7ec;
  color: #2d7a53;
}

.source-podcast {
  background: #f0e6ff;
  color: #6340a3;
}

.source-social {
  background: #e6f6ff;
  color: #2b7189;
}

.source-other {
  background: #eceff4;
  color: #4b5b72;
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.note-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: #e6eefb;
  color: #2a4a78;
  font-size: 12px;
  font-weight: 600;
}

.note-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.note-action.danger {
  background: #f8d8e4;
  color: #b63e67;
}
</style>
