<script setup lang="ts">
import { CircleX, Mic, Square, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { ApiRequestError, api, type PlanSheet, type PlanState, type PlanStateElement } from '@/lib/api'
import { Button } from '@/components/ui/button'
import PlanBranch from '@/components/sections/PlanBranch.vue'

type PlanElement = PlanStateElement
type PlanSpeechRecognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onend: (() => void) | null
  onerror: ((event: PlanSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: PlanSpeechRecognitionResultEvent) => void) | null
}
type PlanSpeechRecognitionResult = ArrayLike<{ transcript: string }> & { isFinal?: boolean }
type PlanSpeechRecognitionResultEvent = Event & {
  resultIndex?: number
  results: ArrayLike<PlanSpeechRecognitionResult>
}
type PlanSpeechRecognitionErrorEvent = Event & {
  error?: string
}
type PlanSpeechRecognitionConstructor = new () => PlanSpeechRecognition
type CreateIntent =
  | { type: 'root' }
  | { type: 'sibling'; afterId: string }
  | { type: 'child'; parentId: string }
type DragPosition = 'before' | 'after'
type SelectedContext = { type: 'root'; title: string; tasks: PlanElement[] } | { type: 'element'; element: PlanElement; tasks: PlanElement[] }

const PLAN_CONTEXT_TASK_DRAG_TYPE = 'application/x-tommma-context-task-id'
const PLAN_DEFAULT_PROMPT_TEMPLATE = `Ты работаешь с планом задач для разработки приложения.

Название плана: {title}
Путь: {path}
Всего задач: {tasks_count}
Выполнено задач: {completed_count}

Ниже дерево работ: родительские элементы — это разделы и контекст, конечные элементы без дочерних элементов — это задачи.

Твоя задача:
1. Проанализировать дерево работ.
2. Составить технический план реализации.
3. Разбить работу на логичные этапы.
4. Для каждого этапа описать, что нужно изменить, где это вероятно внедряется, зависимости, риски и проверки.
5. Не начинай реализацию сразу. Сначала напиши, как понял задачу, и предложи план работ.
6. Если есть неоднозначные задачи, явно задай вопросы.

Вот дерево задач:
{tree}`
const PLAN_ITEM_LEFT_PADDING = 16
const PLAN_ITEM_RIGHT_PADDING = 48
const PLAN_ITEM_MAX_WIDTH = 320
const PLAN_ITEM_MIN_WIDTH = 160
const PLAN_COLUMN_MAX_WIDTH = 1200
const PLAN_ELEMENT_MIN_HEIGHT = 40
const PLAN_PARENT_ELEMENT_MIN_HEIGHT = 80
const PLAN_PROGRESS_BADGE_WIDTH = 38
const PLAN_PROGRESS_BADGE_GAP = 8
const PLAN_SHEETS_BAR_HEIGHT = 44
const PLAN_DEFAULT_SHEET_ID = 'default-sheet'
const PLAN_ITEM_FONT = '600 13px "Inter Variable", "Inter", system-ui, sans-serif'
const PLAN_BRANCH_COLOR_OPTIONS = ['#8B5CF6', '#2563EB', '#0891B2', '#059669', '#D97706', '#DC2626', '#DB2777', '#566071']

const planSheets = ref<PlanSheet[]>([])
const activeSheetId = ref('')
const editingSheetId = ref('')
const editingSheetDraft = ref('')
const namingElementId = ref('')
const createIntent = ref<CreateIntent | null>(null)
const pendingDeleteElementId = ref('')
const selectedElementId = ref('')
const focusedElementId = ref('')
const hoveredNextStepRootId = ref('')
const nameDraft = ref('')
const contextNoteDraft = ref('')
const nameInputRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const contextNoteRef = ref<HTMLTextAreaElement | null>(null)
const viewportHeight = ref(typeof window === 'undefined' ? 0 : window.innerHeight)
const planCopyStatus = ref('')
const isRecordingNote = ref(false)
const noteSpeechPreview = ref('')
const noteSpeechError = ref('')
let planCopyStatusTimeout: number | null = null
let noteSpeechRecognition: PlanSpeechRecognition | null = null
let noteSpeechRestartTimeout: number | null = null
let noteSpeechShouldContinue = false
let noteSpeechPendingTranscript = ''
let noteMediaRecorder: MediaRecorder | null = null
let noteMediaStream: MediaStream | null = null
let noteMediaChunks: Blob[] = []

let measureCanvas: HTMLCanvasElement | null = null
let planStateHydrating = false
let planSyncDirty = false
let planSyncInFlight = false
let planSyncPendingAfterFlight = false
let planSyncRetryTimeout: number | null = null
let planSyncInterval: number | null = null
let planServerUpdatedAt: string | null = null

const activeSheet = computed(() =>
  planSheets.value.find((sheet) => sheet.id === activeSheetId.value) || planSheets.value[0] || null,
)

const rootChildren = computed<PlanElement[]>({
  get() {
    return activeSheet.value?.elements || []
  },
  set(elements) {
    updateActiveSheet({ elements })
  },
})

const deletedElementIds = computed<Record<string, number>>({
  get() {
    return activeSheet.value?.deletedElementIds || {}
  },
  set(deletedIds) {
    updateActiveSheet({ deletedElementIds: deletedIds })
  },
})

const focusedElementPath = computed(() =>
  focusedElementId.value ? findPlanElementPath(rootChildren.value, focusedElementId.value) : [],
)

const focusedElement = computed(() => focusedElementPath.value.at(-1) || null)

const focusedAncestors = computed(() => focusedElementPath.value.slice(0, -1))

const planItemWidth = computed(() => {
  const nextStepTaskIds = new Set(activeSheet.value?.nextStepTaskIds || [])
  const measuredElements = focusedElement.value
    ? flattenPlanElements(focusedElement.value.children || [])
    : flattenPlanElements(rootChildren.value)
  const measuredWidths = measuredElements
    .filter((element) => element.title.trim())
    .map((element) =>
      Math.min(
        PLAN_ITEM_MAX_WIDTH,
        Math.ceil(
          measureTextWidth(element.title) +
            PLAN_ITEM_LEFT_PADDING +
            PLAN_ITEM_RIGHT_PADDING +
            (element.children?.length ? PLAN_PROGRESS_BADGE_WIDTH + PLAN_PROGRESS_BADGE_GAP : 0) +
            (containsNextStepTask(element, nextStepTaskIds) ? PLAN_PROGRESS_BADGE_WIDTH + PLAN_PROGRESS_BADGE_GAP : 0),
        ),
      ),
    )

  if (!measuredWidths.length) return PLAN_ITEM_MIN_WIDTH
  return Math.max(PLAN_ITEM_MIN_WIDTH, ...measuredWidths)
})

const rootBranchHeight = computed(() =>
  Math.max(workspaceHeight.value, requiredBranchHeight(rootChildren.value)),
)

const focusedBranchHeight = computed(() =>
  Math.max(workspaceHeight.value, requiredBranchHeight(focusedElement.value?.children || [])),
)

const pendingDeleteElement = computed(() =>
  pendingDeleteElementId.value ? findPlanElementById(rootChildren.value, pendingDeleteElementId.value) : null,
)

const selectedElement = computed(() =>
  selectedElementId.value ? findPlanElementById(rootChildren.value, selectedElementId.value) : null,
)

const selectedContext = computed<SelectedContext | null>(() => {
  if (selectedElementId.value === PLAN_DEFAULT_SHEET_ID) {
    return {
      type: 'root',
      title: activeSheet.value?.title || '',
      tasks: collectTaskElements(rootChildren.value),
    }
  }
  if (!selectedElement.value) return null
  return {
    type: 'element',
    element: selectedElement.value,
    tasks: selectedElement.value.children?.length ? collectTaskElements(selectedElement.value.children) : [],
  }
})

const selectedContextNextStepTasks = computed(() => {
  if (!selectedContext.value || selectedContext.value.type !== 'root' || !activeSheet.value) return []
  const taskIds = new Set(selectedContext.value.tasks.map((task) => task.id))
  return (activeSheet.value.nextStepTaskIds || [])
    .filter((taskId) => taskIds.has(taskId))
    .map((taskId) => selectedContext.value?.tasks.find((task) => task.id === taskId))
    .filter((task): task is PlanElement => Boolean(task))
})

const selectedContextTaskList = computed(() => {
  if (!selectedContext.value) return []
  if (selectedContext.value.type !== 'root') return selectedContext.value.tasks
  const nextStepIds = new Set(selectedContextNextStepTasks.value.map((task) => task.id))
  return selectedContext.value.tasks.filter((task) => !nextStepIds.has(task.id))
})

const selectedContextParentElement = computed(() => {
  if (selectedContext.value?.type !== 'element' || isTaskElement(selectedContext.value.element)) return null
  return selectedContext.value.element
})

const selectedContextElement = computed(() => {
  if (selectedContext.value?.type !== 'element') return null
  return selectedContext.value.element
})

watch(
  () => [selectedContextElement.value?.id || '', selectedContextElement.value?.note || ''] as const,
  ([elementId, note], previousValue) => {
    const previousElementId = previousValue?.[0] || ''
    const isFocusedSameNote =
      elementId &&
      elementId === previousElementId &&
      typeof document !== 'undefined' &&
      document.activeElement === contextNoteRef.value

    if (!isFocusedSameNote) {
      contextNoteDraft.value = note
    }
  },
  { immediate: true },
)

const selectedContextIsTopLevelBranch = computed(() => {
  const element = selectedContextElement.value
  if (!element) return false
  return rootChildren.value.some((rootElement) => rootElement.id === element.id)
})

const supportsNoteSpeechRecognition = computed(() => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const mediaDevices = (navigator as Navigator & { mediaDevices?: { getUserMedia?: unknown } }).mediaDevices
  return typeof mediaDevices?.getUserMedia === 'function' && 'MediaRecorder' in window
})

const noteSpeechButtonTitle = computed(() => {
  if (!supportsNoteSpeechRecognition.value) return 'Голосовой ввод не поддерживается в этом браузере'
  return isRecordingNote.value ? 'Остановить голосовой ввод' : 'Записать примечание голосом'
})

const highlightedNextStepTaskIds = computed(() => {
  if (!hoveredNextStepRootId.value) return []
  const rootElement = rootChildren.value.find((element) => element.id === hoveredNextStepRootId.value)
  if (!rootElement) return []
  const nextStepTaskIds = new Set(activeSheet.value?.nextStepTaskIds || [])
  return collectTaskElements([rootElement])
    .map((task) => task.id)
    .filter((taskId) => nextStepTaskIds.has(taskId))
})

const workspaceHeight = computed(() => Math.max(0, viewportHeight.value - PLAN_SHEETS_BAR_HEIGHT))

const focusedBranchColor = computed(() => focusedElementPath.value[0]?.color)

const activeSheetProgressPercent = computed(() => {
  if (!rootChildren.value.length) return 0
  const progress = rootChildren.value.reduce((total, element) => total + taskProgressRatio(element), 0)
  return Math.round((progress / rootChildren.value.length) * 100)
})

function taskProgressRatio(element: PlanElement): number {
  if (isTaskElement(element)) {
    return element.completed ? 1 : 0
  }
  const children = element.children || []
  if (!children.length) return element.completed ? 1 : 0
  const progress = children.reduce((total, child) => total + taskProgressRatio(child), 0)
  return progress / children.length
}

function requiredElementHeight(element: PlanElement): number {
  const childBranchHeight = requiredBranchHeight(element.children || [])
  const minHeight = isTaskElement(element) ? PLAN_ELEMENT_MIN_HEIGHT : PLAN_PARENT_ELEMENT_MIN_HEIGHT
  return Math.max(minHeight, childBranchHeight)
}

function isTaskElement(element: PlanElement) {
  return element.type === 'task' || (!element.type && !element.children?.length)
}

function requiredBranchHeight(elements: PlanElement[]): number {
  if (elements.length === 1) {
    return requiredElementHeight(elements[0]) * 2
  }
  return elements.reduce((total, element) => total + requiredElementHeight(element), 0)
}

function updateViewportHeight() {
  viewportHeight.value = window.innerHeight
}

function createPlanSheet(
  title: string,
  elements: PlanElement[] = [],
  deletedIds: Record<string, number> = {},
  id = createClientId(),
): PlanSheet {
  const now = Date.now()
  return {
    id,
    title,
    elements,
    deletedElementIds: deletedIds,
    nextStepTaskIds: [],
    columnWidths: {},
    promptTemplate: '',
    createdAt: now,
    updatedAt: now,
  }
}

function createClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function updateActiveSheet(
  patch: Partial<Pick<PlanSheet, 'elements' | 'deletedElementIds' | 'nextStepTaskIds' | 'columnWidths' | 'promptTemplate' | 'title'>>,
) {
  const sheet = activeSheet.value
  if (!sheet) return
  const updatedAt = Date.now()
  planSheets.value = planSheets.value.map((item) =>
    item.id === sheet.id
      ? {
          ...item,
          ...patch,
          updatedAt,
        }
      : item,
  )
}

function resizePlanColumn(columnId: string, width: number) {
  const sheet = activeSheet.value
  if (!sheet || !columnId) return
  updateActiveSheet({
    columnWidths: {
      ...(sheet.columnWidths || {}),
      [columnId]: Math.min(PLAN_COLUMN_MAX_WIDTH, Math.max(PLAN_ITEM_MIN_WIDTH, Math.round(width))),
    },
  })
  markPlanStateDirty()
}

function addPlanSheet() {
  const nextSheet = createPlanSheet(`Лист ${planSheets.value.length + 1}`)
  planSheets.value = [...planSheets.value, nextSheet]
  activeSheetId.value = nextSheet.id
  markPlanStateDirty()
}

function selectPlanSheet(sheetId: string) {
  if (activeSheetId.value === sheetId) return
  activeSheetId.value = sheetId
  selectedElementId.value = ''
  focusedElementId.value = ''
  closeNameModal()
  cancelDeletePlanElement()
  markPlanStateDirty()
}

function startSheetRename(sheet: PlanSheet) {
  editingSheetId.value = sheet.id
  editingSheetDraft.value = sheet.title
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`input[data-plan-sheet-title="${sheet.id}"]`)
    input?.focus()
    input?.select()
  })
}

function commitSheetRename(sheet: PlanSheet) {
  if (editingSheetId.value !== sheet.id) return
  const title = editingSheetDraft.value.trim()
  editingSheetId.value = ''
  editingSheetDraft.value = ''
  if (!title || title === sheet.title) return
  planSheets.value = planSheets.value.map((item) =>
    item.id === sheet.id
      ? {
          ...item,
          title,
          updatedAt: Date.now(),
        }
      : item,
  )
  markPlanStateDirty()
}

function cancelSheetRename() {
  editingSheetId.value = ''
  editingSheetDraft.value = ''
}

function selectPlanElement(elementId: string) {
  selectedElementId.value = elementId
}

function selectRootElement() {
  if (focusedElementId.value) {
    focusedElementId.value = ''
    selectedElementId.value = ''
    return
  }
  focusedElementId.value = ''
  selectedElementId.value = PLAN_DEFAULT_SHEET_ID
}

function closeContextSidebar() {
  selectedElementId.value = ''
}

function focusPlanElement(elementId: string) {
  const element = findPlanElementById(rootChildren.value, elementId)
  if (!element?.children?.length) return
  focusedElementId.value = elementId
  selectedElementId.value = ''
}

function hoverNextStepRoot(elementId: string) {
  hoveredNextStepRootId.value = elementId
}

function clearNextStepRootHover() {
  hoveredNextStepRootId.value = ''
}

function startContextTaskDrag(event: DragEvent, taskId: string) {
  event.dataTransfer?.setData(PLAN_CONTEXT_TASK_DRAG_TYPE, taskId)
  event.dataTransfer?.setData('text/plain', taskId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function getContextDraggedTaskId(event: DragEvent) {
  return event.dataTransfer?.getData(PLAN_CONTEXT_TASK_DRAG_TYPE) || event.dataTransfer?.getData('text/plain') || ''
}

function allowNextStepDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function dropTaskToNextStep(event: DragEvent) {
  event.preventDefault()
  const taskId = getContextDraggedTaskId(event)
  if (selectedContext.value?.type !== 'root') return
  if (!taskId || !selectedContext.value?.tasks.some((task) => task.id === taskId)) return
  const nextIds = activeSheet.value?.nextStepTaskIds || []
  if (nextIds.includes(taskId)) return
  updateActiveSheet({ nextStepTaskIds: [...nextIds, taskId] })
  markPlanStateDirty()
}

function allowTaskListDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function dropTaskToTaskList(event: DragEvent) {
  event.preventDefault()
  const taskId = getContextDraggedTaskId(event)
  const nextIds = activeSheet.value?.nextStepTaskIds || []
  if (!taskId || !nextIds.includes(taskId)) return
  updateActiveSheet({ nextStepTaskIds: nextIds.filter((id) => id !== taskId) })
  markPlanStateDirty()
}

function getSelectedContextTitle() {
  if (!selectedContext.value) return ''
  return selectedContext.value.type === 'root' ? selectedContext.value.title : selectedContext.value.element.title
}

function getSelectedContextPath() {
  const sheetTitle = activeSheet.value?.title || ''
  if (!selectedContext.value || selectedContext.value.type === 'root') return sheetTitle
  const elementPath = findPlanElementPath(rootChildren.value, selectedContext.value.element.id).map((element) => element.title)
  return [sheetTitle, ...elementPath].filter(Boolean).join(' / ')
}

function getSelectedContextTreeElements() {
  if (!selectedContext.value) return []
  return selectedContext.value.type === 'root' ? rootChildren.value : [selectedContext.value.element]
}

function formatPlanTree(elements: PlanElement[], depth = 0): string[] {
  return elements.flatMap((element) => {
    const prefix = `${'  '.repeat(depth)}-`
    const title = element.title.trim() || 'Без названия'
    const line = element.children?.length
      ? `${prefix} ${title}`
      : `${prefix} [${element.completed ? 'x' : ' '}] ${title}`
    const note = element.note?.trim()
    const noteLines = note ? [`${'  '.repeat(depth + 1)}Примечание: ${note}`] : []
    return [line, ...noteLines, ...formatPlanTree(element.children || [], depth + 1)]
  })
}

function buildContextListText() {
  const title = getSelectedContextTitle()
  const path = getSelectedContextPath()
  const tree = formatPlanTree(getSelectedContextTreeElements()).join('\n') || '- Нет задач'

  return [`# ${title || 'План'}`, '', `Путь: ${path || 'План'}`, '', tree].join('\n')
}

function buildContextPromptText() {
  const elements = getSelectedContextTreeElements()
  const tasks = collectTaskElements(elements)
  const completedTasks = tasks.filter((task) => task.completed)
  const replacements: Record<string, string> = {
    title: getSelectedContextTitle() || 'План',
    path: getSelectedContextPath() || 'План',
    tasks_count: String(tasks.length),
    completed_count: String(completedTasks.length),
    tree: formatPlanTree(elements).join('\n') || '- Нет задач',
  }

  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    normalizePromptTemplate(activeSheet.value?.promptTemplate),
  )
}

function setPlanCopyStatus(status: string) {
  planCopyStatus.value = status
  if (planCopyStatusTimeout) {
    window.clearTimeout(planCopyStatusTimeout)
  }
  planCopyStatusTimeout = window.setTimeout(() => {
    planCopyStatus.value = ''
    planCopyStatusTimeout = null
  }, 1800)
}

async function copyTextToClipboard(text: string) {
  let clipboardError: unknown = null

  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      clipboardError = error
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) {
    throw clipboardError || new Error('Clipboard copy failed')
  }
}

async function copyContextList() {
  try {
    await copyTextToClipboard(buildContextListText())
    setPlanCopyStatus('Список скопирован')
  } catch {
    setPlanCopyStatus('Не удалось скопировать')
  }
}

async function copyContextWithPrompt() {
  try {
    await copyTextToClipboard(buildContextPromptText())
    setPlanCopyStatus('Промпт скопирован')
  } catch {
    setPlanCopyStatus('Не удалось скопировать')
  }
}

function updatePlanPromptTemplate(promptTemplate: string) {
  updateActiveSheet({ promptTemplate })
  markPlanStateDirty()
}

function getSpeechRecognitionConstructor(): PlanSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as Window & {
    SpeechRecognition?: PlanSpeechRecognitionConstructor
    webkitSpeechRecognition?: PlanSpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null
}

function insertTextIntoSelectedNote(text: string) {
  const element = selectedContextElement.value
  if (!element || !text.trim()) return
  const textarea = contextNoteRef.value
  const currentNote = contextNoteDraft.value
  const start = textarea?.selectionStart ?? currentNote.length
  const end = textarea?.selectionEnd ?? start
  const prefix = currentNote.slice(0, start)
  const suffix = currentNote.slice(end)
  const spacer = prefix && !prefix.endsWith(' ') && !text.startsWith(' ') ? ' ' : ''
  const nextText = `${prefix}${spacer}${text.trim()}${suffix}`
  const cursorPosition = prefix.length + spacer.length + text.trim().length
  contextNoteDraft.value = nextText
  updatePlanElementNote(element.id, nextText)
  void nextTick(() => {
    contextNoteRef.value?.focus()
    contextNoteRef.value?.setSelectionRange(cursorPosition, cursorPosition)
  })
}

function stopNoteSpeechRecording() {
  commitNoteSpeechPendingTranscript()
  noteSpeechShouldContinue = false
  if (noteSpeechRestartTimeout) {
    window.clearTimeout(noteSpeechRestartTimeout)
    noteSpeechRestartTimeout = null
  }
  if (!noteSpeechRecognition) {
    isRecordingNote.value = false
    noteSpeechPreview.value = ''
    return
  }

  try {
    noteSpeechRecognition.stop()
  } catch {
    noteSpeechRecognition.abort?.()
    noteSpeechRecognition = null
    isRecordingNote.value = false
    noteSpeechPreview.value = ''
  }
}

function isFatalNoteSpeechError(error: string | undefined) {
  return error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture' || error === 'network'
}

function commitNoteSpeechPendingTranscript() {
  const transcript = noteSpeechPendingTranscript.trim()
  if (!transcript) return
  noteSpeechPendingTranscript = ''
  noteSpeechPreview.value = ''
  insertTextIntoSelectedNote(transcript)
}

function getNoteAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || ''
}

function cleanupNoteMediaRecording() {
  noteMediaStream?.getTracks().forEach((track) => track.stop())
  noteMediaStream = null
  noteMediaRecorder = null
  noteMediaChunks = []
}

async function transcribeNoteAudio(audio: Blob) {
  if (!audio.size) return
  noteSpeechPreview.value = 'Распознаю...'
  try {
    const result = await api.transcribeSpeech(audio)
    const text = result.text.trim()
    if (text) {
      insertTextIntoSelectedNote(text)
      noteSpeechPreview.value = ''
    } else {
      noteSpeechPreview.value = ''
      noteSpeechError.value = 'Речь не распознана'
    }
  } catch (error) {
    noteSpeechPreview.value = ''
    if (error instanceof ApiRequestError && error.status === 503) {
      noteSpeechError.value = 'Нужно настроить OPENAI_API_KEY на backend'
      return
    }
    noteSpeechError.value = 'Не удалось распознать аудио'
  }
}

async function startNoteMediaRecording() {
  if (!selectedContextElement.value) return
  if (!supportsNoteSpeechRecognition.value) {
    noteSpeechError.value = 'Голосовой ввод не поддерживается в этом браузере'
    return
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = getNoteAudioMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    noteMediaStream = stream
    noteMediaRecorder = recorder
    noteMediaChunks = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) {
        noteMediaChunks.push(event.data)
      }
    }
    recorder.onstop = () => {
      const audio = new Blob(noteMediaChunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
      cleanupNoteMediaRecording()
      isRecordingNote.value = false
      void transcribeNoteAudio(audio)
    }
    recorder.onerror = () => {
      cleanupNoteMediaRecording()
      isRecordingNote.value = false
      noteSpeechPreview.value = ''
      noteSpeechError.value = 'Не удалось записать аудио'
    }
    recorder.start()
    isRecordingNote.value = true
    noteSpeechError.value = ''
    noteSpeechPreview.value = ''
  } catch {
    cleanupNoteMediaRecording()
    isRecordingNote.value = false
    noteSpeechError.value = 'Разрешите доступ к микрофону'
  }
}

function stopNoteMediaRecording() {
  if (!noteMediaRecorder) {
    cleanupNoteMediaRecording()
    isRecordingNote.value = false
    return
  }

  if (noteMediaRecorder.state === 'inactive') {
    cleanupNoteMediaRecording()
    isRecordingNote.value = false
    return
  }

  noteMediaRecorder.stop()
}

function restartNoteSpeechRecognition(recognition: PlanSpeechRecognition) {
  if (!noteSpeechShouldContinue || noteSpeechRecognition !== recognition || !selectedContextElement.value) {
    isRecordingNote.value = false
    noteSpeechPreview.value = ''
    if (noteSpeechRecognition === recognition) {
      noteSpeechRecognition = null
    }
    return
  }

  if (noteSpeechRestartTimeout) return
  noteSpeechRestartTimeout = window.setTimeout(() => {
    noteSpeechRestartTimeout = null
    if (!noteSpeechShouldContinue || noteSpeechRecognition !== recognition || !selectedContextElement.value) return
    noteSpeechRecognition = null
    startNoteSpeechRecognition()
  }, 150)
}

function getNoteSpeechErrorMessage(error: string | undefined) {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Разрешите доступ к микрофону'
  }
  if (error === 'no-speech') {
    return 'Речь не распознана'
  }
  if (error === 'audio-capture') {
    return 'Микрофон недоступен'
  }
  if (error === 'network') {
    return 'Сервис распознавания речи недоступен'
  }
  return 'Не удалось запустить голосовой ввод'
}

function startNoteSpeechRecognition() {
  const Recognition = getSpeechRecognitionConstructor()
  if (!selectedContextElement.value) return
  if (!Recognition) {
    noteSpeechError.value = 'Голосовой ввод не поддерживается в этом браузере'
    noteSpeechShouldContinue = false
    return
  }

  const recognition = new Recognition()
  noteSpeechRecognition = recognition
  recognition.lang = 'ru-RU'
  recognition.continuous = true
  recognition.interimResults = true
  recognition.onresult = (event) => {
    let finalTranscript = ''
    let interimTranscript = ''
    const startIndex = event.resultIndex || 0
    for (let resultIndex = startIndex; resultIndex < event.results.length; resultIndex += 1) {
      const result = event.results[resultIndex]
      let transcript = ''
      for (let itemIndex = 0; itemIndex < result.length; itemIndex += 1) {
        transcript += result[itemIndex]?.transcript || ''
      }
      if (result.isFinal) {
        finalTranscript += transcript
      } else {
        interimTranscript += transcript
      }
    }
    if (finalTranscript.trim()) {
      noteSpeechPendingTranscript = ''
      insertTextIntoSelectedNote(finalTranscript)
    }
    noteSpeechPendingTranscript = interimTranscript.trim()
    noteSpeechPreview.value = interimTranscript.trim()
  }
  recognition.onend = () => {
    commitNoteSpeechPendingTranscript()
    restartNoteSpeechRecognition(recognition)
  }
  recognition.onerror = (event) => {
    if (!noteSpeechShouldContinue || noteSpeechRecognition !== recognition) return
    if (!isFatalNoteSpeechError(event.error)) {
      noteSpeechPreview.value = ''
      restartNoteSpeechRecognition(recognition)
      return
    }
    noteSpeechError.value = getNoteSpeechErrorMessage(event.error)
    noteSpeechShouldContinue = false
    isRecordingNote.value = false
    noteSpeechPendingTranscript = ''
    noteSpeechPreview.value = ''
    if (noteSpeechRecognition === recognition) {
      noteSpeechRecognition = null
    }
  }
  try {
    recognition.start()
    isRecordingNote.value = true
    noteSpeechError.value = ''
  } catch (error) {
    noteSpeechShouldContinue = false
    noteSpeechRecognition = null
    isRecordingNote.value = false
    noteSpeechPendingTranscript = ''
    noteSpeechPreview.value = ''
    noteSpeechError.value =
      error instanceof Error && error.name === 'InvalidStateError'
        ? 'Голосовой ввод уже запущен'
        : 'Не удалось запустить голосовой ввод'
  }
}

function toggleNoteSpeechRecording() {
  noteSpeechError.value = ''
  if (!selectedContextElement.value) return
  if (isRecordingNote.value) {
    stopNoteMediaRecording()
    return
  }

  stopNoteSpeechRecording()
  cleanupNoteMediaRecording()
  void startNoteMediaRecording()
}

function deleteSelectedContextParent() {
  if (!selectedContextParentElement.value) return
  requestDeletePlanElement(selectedContextParentElement.value.id)
}

function requestDeletePlanElement(elementId: string) {
  const element = findPlanElementById(rootChildren.value, elementId)
  if (!element) return
  if (element.children?.length) {
    pendingDeleteElementId.value = elementId
    return
  }
  deletePlanElement(elementId)
}

function confirmDeletePlanElement() {
  if (!pendingDeleteElementId.value) return
  const elementId = pendingDeleteElementId.value
  pendingDeleteElementId.value = ''
  deletePlanElement(elementId)
}

function cancelDeletePlanElement() {
  pendingDeleteElementId.value = ''
}

function deletePlanElement(elementId: string) {
  const deletedAt = Date.now()
  const deletedIds = collectDeletedElementIds(rootChildren.value, elementId)
  if (!deletedIds.length) return
  deletedElementIds.value = {
    ...deletedElementIds.value,
    ...Object.fromEntries(deletedIds.map((id) => [id, deletedAt])),
  }
  rootChildren.value = removePlanElement(rootChildren.value, elementId)
  if (namingElementId.value === elementId) {
    closeNameModal()
  }
  if (deletedIds.includes(selectedElementId.value)) {
    selectedElementId.value = ''
  }
  if (deletedIds.includes(focusedElementId.value)) {
    focusedElementId.value = ''
  }
  markPlanStateDirty()
}

function openCreateModal(intent: CreateIntent = { type: 'root' }) {
  createIntent.value = intent
  namingElementId.value = ''
  nameDraft.value = ''
  focusNameInput()
}

function focusNameInput() {
  void nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function closeNameModal() {
  namingElementId.value = ''
  createIntent.value = null
  nameDraft.value = ''
}

function submitNameModal() {
  const titles = nameDraft.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!titles.length) return
  if (createIntent.value) {
    const intent = createIntent.value
    const elements = titles.map((title) => createPlanElement(title, getCreateIntentElementType(intent)))
    if (intent.type === 'root') {
      rootChildren.value = [...rootChildren.value, ...elements]
    } else if (intent.type === 'sibling') {
      rootChildren.value = insertSiblingElements(rootChildren.value, intent.afterId, elements)
    } else {
      rootChildren.value = appendChildElements(rootChildren.value, intent.parentId, elements)
    }
    markPlanStateDirty()
    closeNameModal()
    return
  }

  const updatedElements = updatePlanElementTitle(rootChildren.value, namingElementId.value, titles[0] || '')
  if (updatedElements) {
    rootChildren.value = updatedElements
    markPlanStateDirty()
  }
  closeNameModal()
}

function getCreateIntentElementType(intent: CreateIntent): 'parent' | 'task' {
  if (intent.type === 'root') return 'parent'
  if (intent.type === 'child') return 'task'
  const sibling = findPlanElementById(rootChildren.value, intent.afterId)
  return sibling?.type === 'task' ? 'task' : 'parent'
}

function createPlanElement(title: string, type: 'parent' | 'task'): PlanElement {
  const now = Date.now()
  return {
    id: createClientId(),
    title,
    type,
    note: '',
    completed: false,
    createdAt: now,
    updatedAt: now,
    children: [],
  }
}

function flattenPlanElements(elements: PlanElement[]): PlanElement[] {
  return elements.flatMap((element) => [element, ...flattenPlanElements(element.children || [])])
}

function containsNextStepTask(element: PlanElement, nextStepTaskIds: Set<string>): boolean {
  const children = element.children || []
  if (!children.length) return nextStepTaskIds.has(element.id)
  return children.some((child) => containsNextStepTask(child, nextStepTaskIds))
}

function collectTaskElements(elements: PlanElement[]): PlanElement[] {
  return elements.flatMap((element) => {
    if (isTaskElement(element)) return [element]
    return collectTaskElements(element.children || [])
  })
}

function findPlanElementById(elements: PlanElement[], elementId: string): PlanElement | null {
  for (const element of elements) {
    if (element.id === elementId) return element
    const child = findPlanElementById(element.children || [], elementId)
    if (child) return child
  }
  return null
}

function findPlanElementPath(elements: PlanElement[], elementId: string): PlanElement[] {
  for (const element of elements) {
    if (element.id === elementId) return [element]
    const childPath = findPlanElementPath(element.children || [], elementId)
    if (childPath.length) return [element, ...childPath]
  }
  return []
}

function clonePlanElements(elements: PlanElement[]): PlanElement[] {
  return elements.map((element) => ({
    ...element,
    children: clonePlanElements(element.children || []),
  }))
}

function clonePlanSheets(sheets: PlanSheet[]): PlanSheet[] {
  return sheets.map((sheet) => ({
    ...sheet,
    elements: clonePlanElements(sheet.elements),
    deletedElementIds: { ...(sheet.deletedElementIds || {}) },
    nextStepTaskIds: [...(sheet.nextStepTaskIds || [])],
    columnWidths: { ...(sheet.columnWidths || {}) },
    promptTemplate: normalizePromptTemplate(sheet.promptTemplate),
  }))
}

function collectDeletedElementIds(elements: PlanElement[], targetId: string): string[] {
  for (const element of elements) {
    if (element.id === targetId) {
      return flattenPlanElements([element]).map((item) => item.id)
    }
    const childIds = collectDeletedElementIds(element.children || [], targetId)
    if (childIds.length) return childIds
  }
  return []
}

function insertSiblingElements(elements: PlanElement[], afterId: string, newElements: PlanElement[]): PlanElement[] {
  let inserted = false
  const nextElements = elements.map((element) => {
    if (element.id === afterId) {
      inserted = true
      return element
    }
    return {
      ...element,
      children: insertSiblingElements(element.children || [], afterId, newElements),
    }
  })

  if (!inserted) return nextElements
  const afterIndex = nextElements.findIndex((element) => element.id === afterId)
  return [
    ...nextElements.slice(0, afterIndex + 1),
    ...newElements,
    ...nextElements.slice(afterIndex + 1),
  ]
}

function appendChildElements(elements: PlanElement[], parentId: string, newElements: PlanElement[]): PlanElement[] {
  return elements.map((element) => {
    if (element.id === parentId) {
      return {
        ...element,
        type: 'parent',
        children: [...(element.children || []), ...newElements],
      }
    }
    return {
      ...element,
      children: appendChildElements(element.children || [], parentId, newElements),
    }
  })
}

function removePlanElement(elements: PlanElement[], targetId: string): PlanElement[] {
  return elements
    .filter((element) => element.id !== targetId)
    .map((element) => ({
      ...element,
      children: removePlanElement(element.children || [], targetId),
    }))
}

function updatePlanElementTitle(elements: PlanElement[], elementId: string, title: string): PlanElement[] | null {
  let changed = false
  const nextElements = elements.map((element) => {
    if (element.id === elementId) {
      changed = true
      return {
        ...element,
        title,
        updatedAt: Date.now(),
      }
    }
    const nextChildren = updatePlanElementTitle(element.children || [], elementId, title)
    if (nextChildren) {
      changed = true
      return {
        ...element,
        children: nextChildren,
      }
    }
    return element
  })
  return changed ? nextElements : null
}

function togglePlanElementCompleted(elementId: string, completed: boolean) {
  const updatedElements = updatePlanElementCompleted(rootChildren.value, elementId, completed)
  if (!updatedElements) return
  rootChildren.value = updatedElements
  markPlanStateDirty()
}

function renamePlanElement(elementId: string, title: string) {
  const updatedElements = updatePlanElementTitle(rootChildren.value, elementId, title)
  if (!updatedElements) return
  rootChildren.value = updatedElements
  markPlanStateDirty()
}

function updatePlanElementNote(elementId: string, note: string) {
  const updatedElements = updatePlanElementNoteInList(rootChildren.value, elementId, note)
  if (!updatedElements) return
  rootChildren.value = updatedElements
  markPlanStateDirty()
}

function handleContextNoteInput(note: string) {
  const element = selectedContextElement.value
  if (!element) return
  contextNoteDraft.value = note
  updatePlanElementNote(element.id, note)
}

function updatePlanElementColor(elementId: string, color: string) {
  const updatedElements = updatePlanElementColorInList(rootChildren.value, elementId, color)
  if (!updatedElements) return
  rootChildren.value = updatedElements
  markPlanStateDirty()
}

function reorderPlanElement(draggedId: string, targetId: string, position: DragPosition) {
  const result = reorderPlanElementInList(rootChildren.value, draggedId, targetId, position)
  if (!result.changed) return
  rootChildren.value = result.elements
  markPlanStateDirty()
}

function updatePlanElementNoteInList(elements: PlanElement[], elementId: string, note: string): PlanElement[] | null {
  let changed = false
  const nextElements = elements.map((element) => {
    if (element.id === elementId) {
      changed = true
      return {
        ...element,
        note,
        updatedAt: Date.now(),
      }
    }
    const nextChildren = updatePlanElementNoteInList(element.children || [], elementId, note)
    if (nextChildren) {
      changed = true
      return {
        ...element,
        children: nextChildren,
      }
    }
    return element
  })
  return changed ? nextElements : null
}

function updatePlanElementColorInList(elements: PlanElement[], elementId: string, color: string): PlanElement[] | null {
  let changed = false
  const nextElements = elements.map((element) => {
    if (element.id === elementId) {
      changed = true
      return {
        ...element,
        color,
        updatedAt: Date.now(),
      }
    }
    const nextChildren = updatePlanElementColorInList(element.children || [], elementId, color)
    if (nextChildren) {
      changed = true
      return {
        ...element,
        children: nextChildren,
      }
    }
    return element
  })
  return changed ? nextElements : null
}

function reorderPlanElementInList(
  elements: PlanElement[],
  draggedId: string,
  targetId: string,
  position: DragPosition,
): { elements: PlanElement[]; changed: boolean } {
  const draggedIndex = elements.findIndex((element) => element.id === draggedId)
  const targetIndex = elements.findIndex((element) => element.id === targetId)

  if (draggedIndex >= 0 && targetIndex >= 0) {
    const nextElements = [...elements]
    const [draggedElement] = nextElements.splice(draggedIndex, 1)
    const nextTargetIndex = nextElements.findIndex((element) => element.id === targetId)
    const insertIndex = nextTargetIndex + (position === 'after' ? 1 : 0)
    nextElements.splice(insertIndex, 0, {
      ...draggedElement,
      updatedAt: Date.now(),
    })
    return {
      elements: nextElements,
      changed: nextElements.some((element, index) => element.id !== elements[index]?.id),
    }
  }

  let changed = false
  const nextElements = elements.map((element) => {
    const result = reorderPlanElementInList(element.children || [], draggedId, targetId, position)
    if (!result.changed) return element
    changed = true
    return {
      ...element,
      children: result.elements,
    }
  })

  return { elements: nextElements, changed }
}

function updatePlanElementCompleted(
  elements: PlanElement[],
  elementId: string,
  completed: boolean,
): PlanElement[] | null {
  let changed = false
  const nextElements = elements.map((element) => {
    if (element.id === elementId) {
      changed = true
      return {
        ...element,
        completed,
        updatedAt: Date.now(),
      }
    }
    const nextChildren = updatePlanElementCompleted(element.children || [], elementId, completed)
    if (nextChildren) {
      changed = true
      return {
        ...element,
        children: nextChildren,
      }
    }
    return element
  })
  return changed ? nextElements : null
}

function measureTextWidth(text: string) {
  if (typeof document === 'undefined') return text.length * 8
  measureCanvas ||= document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) return text.length * 8
  context.font = PLAN_ITEM_FONT
  return context.measureText(text).width
}

function normalizeDeletedElementIds(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, number>>((acc, [id, value]) => {
    if (!id) return acc
    const timestamp = Number(value)
    if (Number.isFinite(timestamp) && timestamp >= 0) {
      acc[id] = timestamp
    }
    return acc
  }, {})
}

function normalizePromptTemplate(raw: unknown) {
  if (typeof raw === 'string' && raw.trim()) return raw
  return PLAN_DEFAULT_PROMPT_TEMPLATE
}

function normalizePlanElementColor(raw: unknown) {
  if (typeof raw !== 'string') return undefined
  const color = raw.trim()
  if (!color) return undefined
  return color.slice(0, 32)
}

function normalizePlanElements(raw: unknown): PlanElement[] {
  if (!Array.isArray(raw)) return []
  return raw.reduce<PlanElement[]>((acc, item) => {
    if (!item || typeof item !== 'object') return acc
    const candidate = item as Partial<PlanElement>
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return acc
    const createdAt = Number(candidate.createdAt || Date.now())
    const updatedAt = Number(candidate.updatedAt || createdAt)
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return acc
    const children = normalizePlanElements(candidate.children)
    acc.push({
      id: candidate.id,
      title: candidate.title,
      type: candidate.type === 'parent' || candidate.type === 'task' ? candidate.type : children.length ? 'parent' : 'task',
      note: typeof candidate.note === 'string' ? candidate.note : '',
      color: normalizePlanElementColor(candidate.color),
      completed: candidate.completed === true,
      createdAt,
      updatedAt,
      children,
    })
    return acc
  }, [])
}

function normalizePlanSheets(state: PlanState): PlanSheet[] {
  const now = Date.now()
  if (Array.isArray(state.sheets) && state.sheets.length) {
    return state.sheets.reduce<PlanSheet[]>((acc, sheet, index) => {
      if (!sheet || typeof sheet !== 'object') return acc
      const createdAt = Number(sheet.createdAt || now)
      const updatedAt = Number(sheet.updatedAt || createdAt)
      if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return acc
      acc.push({
        id: typeof sheet.id === 'string' && sheet.id ? sheet.id : createClientId(),
        title: typeof sheet.title === 'string' && sheet.title.trim() ? sheet.title.trim() : `Лист ${index + 1}`,
        elements: normalizePlanElements(sheet.elements),
        deletedElementIds: normalizeDeletedElementIds(sheet.deletedElementIds || {}),
        nextStepTaskIds: Array.isArray(sheet.nextStepTaskIds)
          ? sheet.nextStepTaskIds.filter((taskId): taskId is string => typeof taskId === 'string' && Boolean(taskId))
          : [],
        columnWidths: normalizeColumnWidths(sheet.columnWidths || {}),
        promptTemplate: normalizePromptTemplate(sheet.promptTemplate),
        createdAt,
        updatedAt,
      })
      return acc
    }, [])
  }

  return [
    {
      ...createPlanSheet(
        'Лист 1',
        normalizePlanElements(state.elements),
        normalizeDeletedElementIds(state.deletedElementIds || {}),
        PLAN_DEFAULT_SHEET_ID,
      ),
      createdAt: now,
      updatedAt: now,
    },
  ]
}

function normalizeColumnWidths(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.entries(raw).reduce<Record<string, number>>((acc, [columnId, width]) => {
    if (!columnId) return acc
    const numericWidth = Number(width)
    if (!Number.isFinite(numericWidth)) return acc
    acc[columnId] = Math.min(PLAN_COLUMN_MAX_WIDTH, Math.max(PLAN_ITEM_MIN_WIDTH, Math.round(numericWidth)))
    return acc
  }, {})
}

function buildPlanStatePayload(): PlanState {
  return {
    elements: [],
    deletedElementIds: {},
    sheets: clonePlanSheets(planSheets.value).map((sheet) => ({
      ...sheet,
      nextStepTaskIds: (sheet.nextStepTaskIds || []).filter((taskId) =>
        collectTaskElements(sheet.elements).some((task) => task.id === taskId),
      ),
    })),
    activeSheetId: activeSheetId.value || activeSheet.value?.id || null,
    baseUpdatedAt: planServerUpdatedAt,
  }
}

function isPlanStateEffectivelyEmpty(state: PlanState) {
  const sheets = normalizePlanSheets(state)
  return sheets.length === 1 && sheets[0].elements.length === 0 && Object.keys(sheets[0].deletedElementIds || {}).length === 0
}

function hasLocalPlanData() {
  return planSheets.value.some((sheet) => sheet.elements.length > 0 || Object.keys(sheet.deletedElementIds || {}).length > 0)
}

function mergeDeletedElementIds(
  serverDeleted: Record<string, number>,
  localDeleted: Record<string, number>,
) {
  const merged = { ...serverDeleted }
  for (const [id, deletedAt] of Object.entries(localDeleted)) {
    if (!merged[id] || deletedAt > merged[id]) {
      merged[id] = deletedAt
    }
  }
  return merged
}

function mergePlanStates(server: PlanState, local: PlanState): PlanState {
  const sheets = mergePlanSheets(normalizePlanSheets(server), normalizePlanSheets(local))

  return {
    elements: [],
    deletedElementIds: {},
    sheets,
    activeSheetId: local.activeSheetId || server.activeSheetId || sheets[0]?.id || null,
    updatedAt: server.updatedAt ?? null,
    baseUpdatedAt: server.updatedAt ?? null,
  }
}

function mergePlanSheets(serverSheets: PlanSheet[], localSheets: PlanSheet[]): PlanSheet[] {
  const localById = new Map(localSheets.map((sheet) => [sheet.id, sheet]))
  const usedIds = new Set<string>()
  const merged = localSheets.map((localSheet) => {
    usedIds.add(localSheet.id)
    const serverSheet = serverSheets.find((sheet) => sheet.id === localSheet.id)
    if (!serverSheet) return localSheet
    const deletedElementIds = mergeDeletedElementIds(
      normalizeDeletedElementIds(serverSheet.deletedElementIds || {}),
      normalizeDeletedElementIds(localSheet.deletedElementIds || {}),
    )
    const elements = filterDeletedPlanElements(
      mergePlanElementLists(normalizePlanElements(serverSheet.elements), normalizePlanElements(localSheet.elements)),
      deletedElementIds,
    )
    return {
      ...(localSheet.updatedAt >= serverSheet.updatedAt ? localSheet : serverSheet),
      elements,
      deletedElementIds,
      nextStepTaskIds: [...new Set([...(serverSheet.nextStepTaskIds || []), ...(localSheet.nextStepTaskIds || [])])],
      columnWidths: {
        ...(serverSheet.columnWidths || {}),
        ...(localSheet.columnWidths || {}),
      },
      promptTemplate: normalizePromptTemplate(localSheet.promptTemplate || serverSheet.promptTemplate),
    }
  })

  for (const serverSheet of serverSheets) {
    if (!localById.has(serverSheet.id) && !usedIds.has(serverSheet.id)) {
      merged.push(serverSheet)
    }
  }

  return merged
}

function mergePlanElementLists(serverElements: PlanElement[], localElements: PlanElement[]): PlanElement[] {
  const localById = new Map(localElements.map((element) => [element.id, element]))
  const usedIds = new Set<string>()
  const merged: PlanElement[] = localElements.map((localElement) => {
    usedIds.add(localElement.id)
    const serverElement = serverElements.find((element) => element.id === localElement.id)
    if (!serverElement) return localElement
    const latestElement = localElement.updatedAt >= serverElement.updatedAt ? localElement : serverElement
    return {
      ...latestElement,
      children: mergePlanElementLists(serverElement.children || [], localElement.children || []),
    }
  })

  for (const serverElement of serverElements) {
    if (!localById.has(serverElement.id) && !usedIds.has(serverElement.id)) {
      merged.push(serverElement)
    }
  }

  return merged
}

function filterDeletedPlanElements(
  elements: PlanElement[],
  deletedIds: Record<string, number>,
): PlanElement[] {
  return elements
    .filter((element) => {
      const deletedAt = deletedIds[element.id]
      return !deletedAt || deletedAt < element.updatedAt
    })
    .map((element) => ({
      ...element,
      children: filterDeletedPlanElements(element.children || [], deletedIds),
    }))
}

function applyPlanState(state: PlanState) {
  planStateHydrating = true
  try {
    const nextSheets = normalizePlanSheets(state).map((sheet) => ({
      ...sheet,
      elements: filterDeletedPlanElements(sheet.elements, sheet.deletedElementIds || {}),
      nextStepTaskIds: (sheet.nextStepTaskIds || []).filter((taskId) =>
        collectTaskElements(sheet.elements).some((task) => task.id === taskId),
      ),
    }))
    planSheets.value = nextSheets.length ? nextSheets : [createPlanSheet('Лист 1')]
    activeSheetId.value = state.activeSheetId && planSheets.value.some((sheet) => sheet.id === state.activeSheetId)
      ? state.activeSheetId
      : planSheets.value[0]?.id || ''
    planServerUpdatedAt = state.updatedAt ?? null
  } finally {
    planStateHydrating = false
  }
}

function schedulePlanStateSync(delayMs = 0) {
  if (planSyncRetryTimeout) {
    window.clearTimeout(planSyncRetryTimeout)
  }
  planSyncRetryTimeout = window.setTimeout(() => {
    planSyncRetryTimeout = null
    void syncPlanState()
  }, delayMs)
}

function markPlanStateDirty() {
  if (planStateHydrating) return
  planSyncDirty = true
  schedulePlanStateSync(250)
}

async function syncPlanState() {
  if (planStateHydrating) return
  if (planSyncInFlight) {
    planSyncPendingAfterFlight = true
    return
  }

  planSyncInFlight = true
  try {
    if (planSyncDirty) {
      const localPayload = buildPlanStatePayload()
      let result: Awaited<ReturnType<typeof api.putPlanState>>
      try {
        result = await api.putPlanState(localPayload)
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 409) {
          const current = (error.payload as { planState?: PlanState } | undefined)?.planState
          if (current) {
            const merged = mergePlanStates(current, localPayload)
            applyPlanState(merged)
            planSyncDirty = true
            schedulePlanStateSync(0)
            return
          }
        }
        throw error
      }
      applyPlanState(result.planState)
      planSyncDirty = false
    } else {
      const result = await api.getPlanState()
      if (isPlanStateEffectivelyEmpty(result.planState) && hasLocalPlanData()) {
        planSyncDirty = true
        schedulePlanStateSync(0)
        return
      }
      applyPlanState(result.planState)
    }
  } catch {
    schedulePlanStateSync(planSyncDirty ? 2000 : 5000)
  } finally {
    planSyncInFlight = false
    if (planSyncPendingAfterFlight) {
      planSyncPendingAfterFlight = false
      schedulePlanStateSync(0)
    }
  }
}

async function loadPlanStateFromServer() {
  try {
    const result = await api.getPlanState()
    applyPlanState(result.planState)
  } catch {
    schedulePlanStateSync(5000)
  }
}

function syncPlanOnForeground() {
  if (document.visibilityState === 'hidden') return
  void syncPlanState()
}

onMounted(async () => {
  updateViewportHeight()
  await loadPlanStateFromServer()
  window.addEventListener('resize', updateViewportHeight)
  window.addEventListener('focus', syncPlanOnForeground)
  document.addEventListener('visibilitychange', syncPlanOnForeground)
  planSyncInterval = window.setInterval(() => {
    void syncPlanState()
  }, 10_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportHeight)
  window.removeEventListener('focus', syncPlanOnForeground)
  document.removeEventListener('visibilitychange', syncPlanOnForeground)
  if (planSyncRetryTimeout) {
    window.clearTimeout(planSyncRetryTimeout)
    planSyncRetryTimeout = null
  }
  if (planSyncInterval) {
    window.clearInterval(planSyncInterval)
    planSyncInterval = null
  }
  if (planCopyStatusTimeout) {
    window.clearTimeout(planCopyStatusTimeout)
    planCopyStatusTimeout = null
  }
  noteSpeechShouldContinue = false
  if (noteSpeechRestartTimeout) {
    window.clearTimeout(noteSpeechRestartTimeout)
    noteSpeechRestartTimeout = null
  }
  try {
    noteSpeechRecognition?.abort?.()
    noteSpeechRecognition?.stop()
  } catch {
    // Ignore browser-specific recognition shutdown errors during unmount.
  }
  noteSpeechRecognition = null
  isRecordingNote.value = false
  noteSpeechPendingTranscript = ''
  noteSpeechPreview.value = ''
  if (noteMediaRecorder?.state && noteMediaRecorder.state !== 'inactive') {
    noteMediaRecorder.stop()
  }
  cleanupNoteMediaRecording()
})
</script>

<template>
  <section class="plan-section" aria-label="План">
    <div class="plan-workspace">
      <aside class="plan-user-rail">
        <button class="plan-user-content" type="button" @click="selectRootElement">
          <span
            class="plan-root-progress"
            :aria-label="`Выполнено ${activeSheetProgressPercent} процентов задач листа`"
          >
            {{ activeSheetProgressPercent }}%
          </span>
          <span class="plan-user-name">{{ activeSheet?.title || '' }}</span>
        </button>
      </aside>
      <template v-if="focusedElement">
        <aside v-for="ancestor in focusedAncestors" :key="ancestor.id" class="plan-focus-rail">
          <button class="plan-user-content" type="button" @click="focusPlanElement(ancestor.id)">
            <span
              class="plan-root-progress"
              :aria-label="`Выполнено ${Math.round(taskProgressRatio(ancestor) * 100)} процентов задач`"
            >
              {{ Math.round(taskProgressRatio(ancestor) * 100) }}%
            </span>
            <span class="plan-user-name">{{ ancestor.title }}</span>
          </button>
        </aside>
        <aside class="plan-focus-rail plan-focus-current-rail">
          <button class="plan-user-content" type="button" @click="selectPlanElement(focusedElement.id)">
            <span
              class="plan-root-progress"
              :aria-label="`Выполнено ${Math.round(taskProgressRatio(focusedElement) * 100)} процентов задач`"
            >
              {{ Math.round(taskProgressRatio(focusedElement) * 100) }}%
            </span>
            <span class="plan-user-name">{{ focusedElement.title }}</span>
          </button>
        </aside>
        <div class="plan-root-branch" :style="{ height: `${focusedBranchHeight}px` }">
          <PlanBranch
            :elements="focusedElement.children || []"
            :column-depth="focusedElementPath.length"
            :item-width="planItemWidth"
            :column-widths="activeSheet?.columnWidths || {}"
            :branch-color="focusedBranchColor"
            :branch-height="focusedBranchHeight"
            :is-root="false"
            :next-step-task-ids="activeSheet?.nextStepTaskIds || []"
            :highlighted-next-step-task-ids="highlightedNextStepTaskIds"
            @add-sibling="(elementId) => openCreateModal({ type: 'sibling', afterId: elementId })"
            @add-child="(elementId) => openCreateModal({ type: 'child', parentId: elementId })"
            @delete="requestDeletePlanElement"
            @expand="focusPlanElement"
            @next-step-badge-hover="hoverNextStepRoot"
            @next-step-badge-leave="clearNextStepRootHover"
            @rename="renamePlanElement"
            @reorder="reorderPlanElement"
            @resize-column="resizePlanColumn"
            @select="selectPlanElement"
            @toggle-complete="togglePlanElementCompleted"
          />
        </div>
      </template>
      <template v-else>
      <button
        v-if="!rootChildren.length"
        class="plan-add-right"
        type="button"
        aria-label="Добавить элемент"
        title="Добавить элемент"
        @click="() => openCreateModal()"
      />
      <div v-else class="plan-root-branch" :style="{ height: `${rootBranchHeight}px` }">
        <PlanBranch
          :elements="rootChildren"
          :column-depth="0"
          :item-width="planItemWidth"
          :column-widths="activeSheet?.columnWidths || {}"
          :branch-height="rootBranchHeight"
          :is-root="true"
          :next-step-task-ids="activeSheet?.nextStepTaskIds || []"
          :highlighted-next-step-task-ids="highlightedNextStepTaskIds"
          @add-sibling="(elementId) => openCreateModal({ type: 'sibling', afterId: elementId })"
          @add-child="(elementId) => openCreateModal({ type: 'child', parentId: elementId })"
          @delete="requestDeletePlanElement"
          @expand="focusPlanElement"
          @next-step-badge-hover="hoverNextStepRoot"
          @next-step-badge-leave="clearNextStepRootHover"
          @rename="renamePlanElement"
          @reorder="reorderPlanElement"
          @resize-column="resizePlanColumn"
          @select="selectPlanElement"
          @toggle-complete="togglePlanElementCompleted"
        />
      </div>
      </template>
    </div>
    <aside v-if="selectedContext" class="plan-context-sidebar" aria-label="Контекст карточки">
      <div class="plan-context-header">
        <h2 class="plan-context-title">
          {{ selectedContext.type === 'root' ? selectedContext.title : selectedContext.element.title }}
        </h2>
        <button
          class="plan-context-close"
          type="button"
          aria-label="Закрыть сайдбар"
          title="Закрыть"
          @click="closeContextSidebar"
        >
          <X class="plan-context-close-icon" />
        </button>
      </div>
      <div class="plan-context-copy">
        <button class="plan-context-copy-button" type="button" @click="copyContextList">
          Скопировать список
        </button>
        <button class="plan-context-copy-button plan-context-copy-button-primary" type="button" @click="copyContextWithPrompt">
          Скопировать с промптом
        </button>
        <span v-if="planCopyStatus" class="plan-context-copy-status">{{ planCopyStatus }}</span>
      </div>
      <details v-if="selectedContext.type === 'root'" class="plan-prompt-settings">
        <summary class="plan-prompt-summary">Настроить промпт</summary>
        <textarea
          class="plan-prompt-template"
          :value="activeSheet?.promptTemplate || ''"
          aria-label="Шаблон промпта для копирования"
          @input="updatePlanPromptTemplate(($event.target as HTMLTextAreaElement).value)"
        />
        <p class="plan-prompt-help">
          Переменные: {title}, {path}, {tasks_count}, {completed_count}, {tree}
        </p>
      </details>
      <div v-if="selectedContextElement && selectedContextIsTopLevelBranch" class="plan-branch-color-control">
        <div class="plan-branch-color-title">Цвет ветки</div>
        <div class="plan-branch-color-swatches" aria-label="Цвет ветки">
          <button
            v-for="color in PLAN_BRANCH_COLOR_OPTIONS"
            :key="color"
            class="plan-branch-color-swatch"
            :class="{ 'plan-branch-color-swatch-active': selectedContextElement.color === color }"
            type="button"
            :aria-label="`Выбрать цвет ${color}`"
            :title="color"
            :style="{ backgroundColor: color }"
            @click="updatePlanElementColor(selectedContextElement.id, color)"
          />
          <button
            class="plan-branch-color-clear"
            type="button"
            aria-label="Убрать цвет ветки"
            title="Убрать цвет"
            @click="updatePlanElementColor(selectedContextElement.id, '')"
          >
            Без цвета
          </button>
        </div>
      </div>
      <div v-if="selectedContextElement" class="plan-context-note-wrap">
        <textarea
          ref="contextNoteRef"
          v-model="contextNoteDraft"
          class="plan-context-note"
          placeholder="Примечание"
          aria-label="Примечание карточки"
          @input="handleContextNoteInput(($event.target as HTMLTextAreaElement).value)"
        />
        <Button
          class="plan-context-note-record"
          :class="{ 'plan-context-note-record-active': isRecordingNote }"
          variant="outline"
          size="sm"
          type="button"
          :aria-label="noteSpeechButtonTitle"
          :title="noteSpeechButtonTitle"
          :aria-pressed="isRecordingNote"
          :disabled="!supportsNoteSpeechRecognition"
          @click="toggleNoteSpeechRecording"
        >
          <Square v-if="isRecordingNote" data-icon="inline-start" />
          <Mic v-else data-icon="inline-start" />
          <span v-if="isRecordingNote" class="plan-context-note-wave" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
          <span class="plan-context-note-record-label">{{ isRecordingNote ? 'Стоп' : 'Голос' }}</span>
        </Button>
      </div>
      <div v-if="noteSpeechPreview || noteSpeechError" class="plan-context-note-speech-status" aria-live="polite">
        {{ noteSpeechError || noteSpeechPreview }}
      </div>
      <div
        v-if="selectedContext.type === 'root' && selectedContext.tasks.length"
        class="plan-next-step"
        @dragenter="allowNextStepDrop"
        @dragover="allowNextStepDrop"
        @drop="dropTaskToNextStep"
      >
        <div class="plan-next-step-title">Следующий шаг</div>
        <div v-if="selectedContextNextStepTasks.length" class="plan-next-step-tasks">
          <label
            v-for="task in selectedContextNextStepTasks"
            :key="task.id"
            class="plan-context-task"
            draggable="true"
            @dragstart="startContextTaskDrag($event, task.id)"
          >
            <input
              class="plan-context-task-checkbox"
              type="checkbox"
              :checked="task.completed"
              :aria-label="`Отметить задачу ${task.title}`"
              @change="togglePlanElementCompleted(task.id, ($event.target as HTMLInputElement).checked)"
            />
            <span class="plan-context-task-title">{{ task.title }}</span>
          </label>
        </div>
      </div>
      <div
        v-if="selectedContext.tasks.length"
        class="plan-context-tasks"
        @dragenter="allowTaskListDrop"
        @dragover="allowTaskListDrop"
        @drop="dropTaskToTaskList"
      >
        <label
          v-for="task in selectedContextTaskList"
          :key="task.id"
          class="plan-context-task"
          draggable="true"
          @dragstart="startContextTaskDrag($event, task.id)"
        >
          <input
            class="plan-context-task-checkbox"
            type="checkbox"
            :checked="task.completed"
            :aria-label="`Отметить задачу ${task.title}`"
            @change="togglePlanElementCompleted(task.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="plan-context-task-title">{{ task.title }}</span>
        </label>
      </div>
      <div v-if="selectedContextParentElement" class="plan-context-actions">
        <button
          class="plan-context-delete"
          type="button"
          aria-label="Удалить элемент"
          title="Удалить"
          @click="deleteSelectedContextParent"
        >
          <CircleX class="plan-context-delete-icon" />
        </button>
      </div>
    </aside>
    <footer class="plan-sheets-bar" aria-label="Листы плана">
      <div class="plan-sheets-tabs">
        <button
          v-for="sheet in planSheets"
          :key="sheet.id"
          class="plan-sheet-tab"
          :class="{ 'plan-sheet-tab-active': sheet.id === activeSheetId }"
          type="button"
          @click="selectPlanSheet(sheet.id)"
          @dblclick.stop="startSheetRename(sheet)"
        >
          <input
            v-if="editingSheetId === sheet.id"
            v-model="editingSheetDraft"
            class="plan-sheet-title-input"
            :data-plan-sheet-title="sheet.id"
            aria-label="Название листа"
            @click.stop
            @dblclick.stop
            @blur="commitSheetRename(sheet)"
            @keydown.enter.prevent="commitSheetRename(sheet)"
            @keydown.esc.prevent="cancelSheetRename"
          />
          <span v-else>{{ sheet.title }}</span>
        </button>
        <button class="plan-sheet-add" type="button" aria-label="Добавить лист" title="Добавить лист" @click="addPlanSheet">
          +
        </button>
      </div>
    </footer>
    <div v-if="createIntent || namingElementId" class="plan-modal-backdrop" @click.self="closeNameModal">
      <form class="plan-modal" @submit.prevent="submitNameModal">
        <textarea
          v-if="createIntent"
          ref="nameInputRef"
          v-model="nameDraft"
          class="plan-name-input plan-name-textarea"
          aria-label="Названия элементов"
          placeholder="Каждая строка — новая карточка"
          @keydown.meta.enter.prevent="submitNameModal"
          @keydown.ctrl.enter.prevent="submitNameModal"
          @keydown.esc.prevent="closeNameModal"
        />
        <input
          v-else
          ref="nameInputRef"
          v-model="nameDraft"
          class="plan-name-input"
          type="text"
          aria-label="Название элемента"
          @keydown.esc.prevent="closeNameModal"
        />
      </form>
    </div>
    <div v-if="pendingDeleteElement" class="plan-modal-backdrop" @click.self="cancelDeletePlanElement">
      <div class="plan-modal plan-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="plan-delete-title">
        <h2 id="plan-delete-title" class="plan-confirm-title">Удалить элемент?</h2>
        <p class="plan-confirm-text">
          «{{ pendingDeleteElement.title }}» содержит дочерние элементы. Они тоже будут удалены.
        </p>
        <div class="plan-confirm-actions">
          <button class="plan-confirm-button plan-confirm-button-secondary" type="button" @click="cancelDeletePlanElement">
            Отмена
          </button>
          <button class="plan-confirm-button plan-confirm-button-danger" type="button" @click="confirmDeletePlanElement">
            Удалить
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.plan-section {
  margin-left: 88px;
  flex: 1;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f3f4f6;
  position: relative;
  overflow: hidden;
}

.plan-workspace {
  box-sizing: border-box;
  height: calc(100vh - 44px);
  display: flex;
  align-items: flex-start;
  background: #f3f4f6;
  position: relative;
  overflow: auto;
}

.plan-user-rail,
.plan-focus-rail {
  box-sizing: border-box;
  width: 40px;
  height: 100%;
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  border-radius: 16px;
  border: 1px solid #B9B9B9;
  border: 1px solid color(display-p3 0.7241 0.7241 0.7241);
  background: #F5F6FD;
  background: color(display-p3 0.9608 0.9647 0.9882);
  box-shadow: 0 0 40px 0 #ABABAB inset;
  box-shadow: 0 0 40px 0 color(display-p3 0.6725 0.6725 0.6725) inset;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.plan-focus-rail {
  position: sticky;
}

.plan-user-rail:hover,
.plan-focus-rail:hover {
  box-shadow: 0 0 40px 0 #969696 inset;
  box-shadow: 0 0 40px 0 color(display-p3 0.5882 0.5882 0.5882) inset;
}

.plan-focus-current-rail {
  box-shadow: 0 0 40px 0 #8f8f8f inset;
  box-shadow: 0 0 40px 0 color(display-p3 0.5608 0.5608 0.5608) inset;
}

.plan-focus-current-rail:hover {
  box-shadow: 0 0 40px 0 #777777 inset;
  box-shadow: 0 0 40px 0 color(display-p3 0.4667 0.4667 0.4667) inset;
}

.plan-user-content {
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 6px;
  padding: 8px;
  font: inherit;
  cursor: pointer;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}

.plan-root-progress {
  min-height: 38px;
  width: 22px;
  border-radius: 999px;
  background: rgba(86, 96, 113, 0.14);
  color: #566071;
  font-size: 10px;
  font-weight: 800;
  line-height: 22px;
  text-align: center;
  flex: 0 0 auto;
}

.plan-user-name {
  min-height: 0;
  color: #242a31;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: normal;
}

.plan-add-right {
  position: absolute;
  left: 36px;
  top: 8px;
  width: 9px;
  height: calc(100% - 16px);
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #6f7890;
  padding: 0;
  cursor: pointer;
  z-index: 1;
}

.plan-add-right:hover {
  background: #B5A5FF;
}

.plan-root-branch {
  min-height: 100%;
  display: flex;
  align-items: stretch;
}

.plan-context-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 44px;
  z-index: 40;
  box-sizing: border-box;
  width: 280px;
  border-left: 1px solid #d8dde8;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: -12px 0 32px rgba(36, 42, 49, 0.08);
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.plan-context-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.plan-context-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: #242a31;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.plan-context-close {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #566071;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
}

.plan-context-close:hover {
  background: rgba(111, 95, 232, 0.1);
  color: #242a31;
}

.plan-context-close-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.plan-context-copy {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.plan-context-copy-button {
  min-height: 34px;
  border: 1px solid #d8dde8;
  border-radius: 10px;
  background: rgba(245, 246, 253, 0.82);
  color: #242a31;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.plan-context-copy-button:hover {
  border-color: rgba(111, 95, 232, 0.34);
  background: rgba(111, 95, 232, 0.1);
}

.plan-context-copy-button-primary {
  background: rgba(111, 95, 232, 0.12);
  color: #4f41c9;
}

.plan-context-copy-status {
  color: #566071;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.plan-prompt-settings {
  margin-top: 12px;
  border: 1px solid #d8dde8;
  border-radius: 10px;
  background: rgba(245, 246, 253, 0.58);
  padding: 9px 10px;
}

.plan-prompt-summary {
  color: #566071;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.plan-prompt-template {
  box-sizing: border-box;
  width: 100%;
  min-height: 180px;
  margin-top: 10px;
  border: 1px solid #d8dde8;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
  color: #242a31;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  outline: none;
  padding: 9px;
  resize: vertical;
}

.plan-prompt-template:focus {
  border-color: rgba(111, 95, 232, 0.5);
  box-shadow: 0 0 0 2px rgba(111, 95, 232, 0.12);
}

.plan-prompt-help {
  margin: 8px 0 0;
  color: #68738a;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.35;
}

.plan-branch-color-control {
  margin-top: 16px;
}

.plan-branch-color-title {
  color: #566071;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.plan-branch-color-swatches {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 9px;
}

.plan-branch-color-swatch {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(36, 42, 49, 0.16);
  padding: 0;
  cursor: pointer;
}

.plan-branch-color-swatch:hover,
.plan-branch-color-swatch-active {
  box-shadow:
    0 0 0 1px rgba(36, 42, 49, 0.16),
    0 0 0 4px rgba(111, 95, 232, 0.18);
}

.plan-branch-color-clear {
  height: 24px;
  border: 1px solid #d8dde8;
  border-radius: 999px;
  background: rgba(245, 246, 253, 0.82);
  color: #566071;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 0 9px;
  cursor: pointer;
}

.plan-branch-color-clear:hover {
  border-color: rgba(111, 95, 232, 0.34);
  color: #242a31;
}

.plan-context-note-wrap {
  position: relative;
  margin-top: 18px;
}

.plan-context-note {
  box-sizing: border-box;
  width: 100%;
  min-height: 88px;
  border: 1px solid #d8dde8;
  border-radius: 10px;
  background: rgba(245, 246, 253, 0.72);
  color: #242a31;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.35;
  outline: none;
  padding: 10px;
  resize: vertical;
}

.plan-context-note-record {
  position: absolute;
  right: 8px;
  bottom: 8px;
  height: 26px;
  gap: 6px;
  border: 1px solid #d8dde8;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #566071;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  padding: 0 10px;
  cursor: pointer;
}

.plan-context-note-record:hover,
.plan-context-note-record-active {
  border-color: rgba(111, 95, 232, 0.44);
  background: rgba(111, 95, 232, 0.14);
  color: #4f41c9;
}

.plan-context-note-record:disabled {
  cursor: not-allowed;
}

.plan-context-note-wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 14px;
}

.plan-context-note-wave span {
  width: 2px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.78;
  animation: plan-note-wave 0.78s ease-in-out infinite;
}

.plan-context-note-wave span:nth-child(2) {
  animation-delay: 0.1s;
}

.plan-context-note-wave span:nth-child(3) {
  animation-delay: 0.2s;
}

.plan-context-note-wave span:nth-child(4) {
  animation-delay: 0.3s;
}

.plan-context-note-wave span:nth-child(5) {
  animation-delay: 0.4s;
}

.plan-context-note-record-label {
  min-width: 0;
}

.plan-context-note-speech-status {
  margin-top: 6px;
  color: #68738a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.25;
}

@keyframes plan-note-wave {
  0%,
  100% {
    height: 5px;
  }

  50% {
    height: 14px;
  }
}

.plan-context-note:focus {
  border-color: rgba(111, 95, 232, 0.5);
  box-shadow: 0 0 0 2px rgba(111, 95, 232, 0.12);
}

.plan-context-note::placeholder {
  color: #8b94a5;
}

.plan-next-step {
  box-sizing: border-box;
  min-height: 92px;
  margin-top: 18px;
  border: 1px dashed #b9c1d0;
  border-radius: 12px;
  background: rgba(245, 246, 253, 0.72);
  padding: 10px;
}

.plan-next-step-title {
  color: #68738a;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
  text-transform: uppercase;
}

.plan-next-step-tasks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.plan-context-tasks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 28px;
  margin-top: 14px;
}

.plan-context-task {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
  color: #242a31;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
}

.plan-context-task[draggable="true"] {
  cursor: grab;
}

.plan-context-task[draggable="true"]:active {
  cursor: grabbing;
}

.plan-context-task-checkbox {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin-top: 1px;
  accent-color: #6f5fe8;
  cursor: pointer;
}

.plan-context-task-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.plan-context-actions {
  margin-top: auto;
  padding-top: 18px;
  display: flex;
  justify-content: flex-end;
}

.plan-context-delete {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #8a4b5f;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  cursor: pointer;
}

.plan-context-delete:hover {
  background: rgba(138, 75, 95, 0.14);
}

.plan-context-delete-icon {
  width: 18px;
  height: 18px;
  stroke-width: 2;
}

.plan-sheets-bar {
  box-sizing: border-box;
  height: 44px;
  flex: 0 0 auto;
  border-top: 1px solid #d8dde8;
  background: #eef1f7;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.plan-sheets-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  padding: 6px 10px;
}

.plan-sheet-tab,
.plan-sheet-add {
  height: 30px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #566071;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.plan-sheet-tab {
  min-width: 72px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 12px;
}

.plan-sheet-title-input {
  width: 120px;
  height: 22px;
  border: 1px solid #c8cfda;
  border-radius: 6px;
  background: #f9fbff;
  color: #242a31;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  outline: none;
  padding: 0 6px;
}

.plan-sheet-tab:hover,
.plan-sheet-add:hover {
  background: rgba(255, 255, 255, 0.64);
}

.plan-sheet-tab-active {
  border-color: #c9d0df;
  background: #ffffff;
  color: #242a31;
  box-shadow: 0 1px 4px rgba(36, 42, 49, 0.08);
}

.plan-sheet-add {
  width: 30px;
  flex: 0 0 auto;
  font-size: 17px;
  line-height: 1;
}

.plan-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(35, 41, 49, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}

.plan-modal {
  width: min(360px, calc(100vw - 40px));
  border-radius: 12px;
  background: #ffffff;
  padding: 14px;
  box-shadow: 0 20px 60px rgba(36, 42, 49, 0.18);
}

.plan-name-input {
  width: 100%;
  height: 42px;
  border: 1px solid #c8cfda;
  border-radius: 8px;
  background: #f9fbff;
  color: #242a31;
  font: inherit;
  outline: none;
  padding: 0 12px;
}

.plan-name-input:focus {
  border-color: #8ea6d8;
  box-shadow: 0 0 0 3px rgba(142, 166, 216, 0.22);
}

.plan-name-textarea {
  box-sizing: border-box;
  height: auto;
  min-height: 128px;
  font-size: 13px;
  line-height: 1.35;
  padding: 10px 12px;
  resize: vertical;
}

.plan-name-textarea::placeholder {
  color: #8b94a5;
}

.plan-confirm-modal {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.plan-confirm-title {
  margin: 0;
  color: #242a31;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
}

.plan-confirm-text {
  margin: 0;
  color: #566071;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.plan-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.plan-confirm-button {
  height: 36px;
  border: 0;
  border-radius: 8px;
  padding: 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.plan-confirm-button-secondary {
  background: #eef1f7;
  color: #3c4658;
}

.plan-confirm-button-secondary:hover {
  background: #e1e6f0;
}

.plan-confirm-button-danger {
  background: #8a4b5f;
  color: #ffffff;
}

.plan-confirm-button-danger:hover {
  background: #75394c;
}

@media (max-width: 980px) {
  .plan-section {
    margin-left: 0;
  }
}
</style>
