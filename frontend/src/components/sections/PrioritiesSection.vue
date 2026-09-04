<script setup lang="ts">
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Inbox,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import type { PriorityGroupView } from '@/app/priority-task-state'
import PriorityTaskScore from '@/components/sections/PriorityTaskScore.vue'
import PriorityTaskTitleDisplay from '@/components/sections/PriorityTaskTitleDisplay.vue'
import type { TaskItem } from '@/lib/app-state'

const SCORE_HIGHLIGHT_DURATION_MS = 1400

const props = defineProps<{
  groups: PriorityGroupView[]
  inboxTasks: TaskItem[]
  completedTasks: TaskItem[]
  trashedTasks: TaskItem[]
  addTask: (title: string) => Promise<unknown>
  adjustScore: (
    taskId: string,
    field: 'importance' | 'urgency',
    delta: -1 | 1,
  ) => Promise<void>
  moveTask: (taskId: string, targetIndex: number) => Promise<void>
  removeTask: (taskId: string) => Promise<void>
  completeTask: (taskId: string) => Promise<void>
  restoreTask: (taskId: string) => Promise<void>
  restoreDeletedTask: (taskId: string) => Promise<void>
  updateTaskTitle: (taskId: string, title: string) => Promise<void>
}>()

const activeView = ref<'main' | 'completed' | 'trash'>('main')
const inboxDraft = ref('')
const submittingInbox = ref(false)
const draggedInboxTaskId = ref('')
const dropTargetInboxTaskId = ref('')
const inboxDropPlacement = ref<'before' | 'after'>('before')
const editingTaskId = ref('')
const editingTaskTitle = ref('')
const savingTaskId = ref('')
const deletingTaskId = ref('')
const restoringDeletedTaskId = ref('')
const highlightedTaskId = ref('')
let scoreHighlightTimeout: number | undefined
const occupiedPrioritySlots = computed(() =>
  props.groups.reduce((total, group) => total + group.tasks.length, 0),
)
const totalPrioritySlots = computed(() =>
  props.groups.reduce((total, group) => total + group.limit, 0),
)

async function submitInboxTask() {
  const title = inboxDraft.value.trim()
  if (!title || submittingInbox.value) return
  submittingInbox.value = true
  try {
    await props.addTask(title)
    inboxDraft.value = ''
  } catch {
    // Global status already contains the API error; keep the draft for retry.
  } finally {
    submittingInbox.value = false
  }
}

function startInboxTaskDrag(event: DragEvent, taskId: string) {
  draggedInboxTaskId.value = taskId
  event.dataTransfer?.setData('application/x-tommma-inbox-task', taskId)
  event.dataTransfer?.setData('text/plain', taskId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function setDraggedInboxTaskFromEvent(event: DragEvent) {
  if (draggedInboxTaskId.value) return
  const taskId =
    event.dataTransfer?.getData('application/x-tommma-inbox-task') ||
    event.dataTransfer?.getData('text/plain') ||
    ''
  if (props.inboxTasks.some((task) => task.id === taskId)) draggedInboxTaskId.value = taskId
}

function allowInboxTaskDrop(event: DragEvent, taskId: string) {
  setDraggedInboxTaskFromEvent(event)
  if (!draggedInboxTaskId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const row = event.currentTarget as HTMLElement
  const bounds = row.getBoundingClientRect()
  dropTargetInboxTaskId.value = taskId
  inboxDropPlacement.value = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

function resetInboxDrag() {
  draggedInboxTaskId.value = ''
  dropTargetInboxTaskId.value = ''
  inboxDropPlacement.value = 'before'
}

function inboxDropClass(taskId: string) {
  if (dropTargetInboxTaskId.value !== taskId) return ''
  return inboxDropPlacement.value === 'before' ? 'drop-before' : 'drop-after'
}

async function dropOnInboxTask(event: DragEvent, targetTaskId: string, targetIndex: number) {
  event.preventDefault()
  setDraggedInboxTaskFromEvent(event)
  const taskId = draggedInboxTaskId.value
  if (!taskId || taskId === targetTaskId) {
    resetInboxDrag()
    return
  }

  const sourceIndex = props.inboxTasks.findIndex((task) => task.id === taskId)
  const requestedIndex = targetIndex + (inboxDropPlacement.value === 'after' ? 1 : 0)
  const normalizedIndex =
    sourceIndex >= 0 && sourceIndex < requestedIndex ? requestedIndex - 1 : requestedIndex
  resetInboxDrag()
  await props.moveTask(taskId, normalizedIndex)
}

function taskCountLabel(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} задач`
  if (mod10 === 1) return `${count} задача`
  if (mod10 >= 2 && mod10 <= 4) return `${count} задачи`
  return `${count} задач`
}

function deletionTimeLabel(deletedAt: string | null) {
  if (!deletedAt) return ''
  const date = new Date(deletedAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function taskTitleCaretOffset(event: MouseEvent, title: string) {
  if (event.detail === 0) return title.length

  const titleElement = event.currentTarget as HTMLElement
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caretPosition = caretDocument.caretPositionFromPoint?.(event.clientX, event.clientY)
  const caretRange = caretPosition ? null : caretDocument.caretRangeFromPoint?.(event.clientX, event.clientY)
  const offsetNode = caretPosition?.offsetNode ?? caretRange?.startContainer
  const rawOffset = caretPosition?.offset ?? caretRange?.startOffset

  const segmentElement = offsetNode?.parentElement?.closest<HTMLElement>('[data-title-offset]')
  if (segmentElement && titleElement.contains(segmentElement) && rawOffset !== undefined) {
    const segmentOffset = Number(segmentElement.dataset.titleOffset)
    if (Number.isFinite(segmentOffset)) {
      return Math.min(title.length, Math.max(0, segmentOffset + rawOffset))
    }
  }

  if (offsetNode?.nodeType === Node.TEXT_NODE && rawOffset !== undefined && titleElement.contains(offsetNode)) {
    const nodeText = offsetNode.textContent ?? ''
    const titleStart = Math.max(0, nodeText.indexOf(title))
    return Math.min(title.length, Math.max(0, rawOffset - titleStart))
  }

  const context = document.createElement('canvas').getContext('2d')
  if (!context) return title.length
  const styles = window.getComputedStyle(titleElement)
  context.font = styles.font
  const bounds = titleElement.getBoundingClientRect()
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
  const letterSpacing = Number.parseFloat(styles.letterSpacing) || 0
  const clickOffset = event.clientX - bounds.left - paddingLeft
  if (clickOffset <= 0) return 0

  let previousWidth = 0
  for (let offset = 1; offset <= title.length; offset += 1) {
    const currentWidth = context.measureText(title.slice(0, offset)).width + letterSpacing * (offset - 1)
    if (clickOffset < (previousWidth + currentWidth) / 2) return offset - 1
    previousWidth = currentWidth
  }
  return title.length
}

async function startTaskTitleEdit(task: TaskItem, event: MouseEvent) {
  if (savingTaskId.value === task.id) return
  const caretOffset = taskTitleCaretOffset(event, task.title)
  editingTaskId.value = task.id
  editingTaskTitle.value = task.title
  await nextTick()
  const input = document.querySelector<HTMLInputElement>(`input[data-priority-title-edit="${task.id}"]`)
  input?.focus()
  input?.setSelectionRange(caretOffset, caretOffset)
}

function cancelTaskTitleEdit() {
  editingTaskId.value = ''
  editingTaskTitle.value = ''
}

async function saveTaskTitle(task: TaskItem) {
  if (editingTaskId.value !== task.id || savingTaskId.value === task.id) return
  const title = editingTaskTitle.value.trim()
  if (!title || title === task.title) {
    cancelTaskTitleEdit()
    return
  }

  savingTaskId.value = task.id
  try {
    await props.updateTaskTitle(task.id, title)
    if (editingTaskId.value === task.id) cancelTaskTitleEdit()
  } catch {
    if (savingTaskId.value === task.id) savingTaskId.value = ''
    await nextTick()
    const input = document.querySelector<HTMLInputElement>(`input[data-priority-title-edit="${task.id}"]`)
    input?.focus()
  } finally {
    if (savingTaskId.value === task.id) savingTaskId.value = ''
  }
}

async function adjustTaskScore(
  taskId: string,
  field: 'importance' | 'urgency',
  delta: -1 | 1,
) {
  await props.adjustScore(taskId, field, delta)
  await nextTick()

  const taskElement = document.getElementById(`priority-task-${taskId}`)
  if (!taskElement) return

  const bounds = taskElement.getBoundingClientRect()
  const isFullyVisible = bounds.top >= 0 && bounds.bottom <= window.innerHeight
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  taskElement.scrollIntoView({
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
    block: isFullyVisible ? 'nearest' : 'center',
    inline: 'nearest',
  })

  highlightedTaskId.value = ''
  await nextTick()
  highlightedTaskId.value = taskId

  if (scoreHighlightTimeout !== undefined) window.clearTimeout(scoreHighlightTimeout)
  scoreHighlightTimeout = window.setTimeout(() => {
    if (highlightedTaskId.value === taskId) highlightedTaskId.value = ''
    scoreHighlightTimeout = undefined
  }, SCORE_HIGHLIGHT_DURATION_MS)
}

async function deleteTask(taskId: string) {
  if (deletingTaskId.value) return
  if (editingTaskId.value === taskId) cancelTaskTitleEdit()
  deletingTaskId.value = taskId
  try {
    await props.removeTask(taskId)
  } catch {
    // Global status already contains the API error.
  } finally {
    deletingTaskId.value = ''
  }
}

async function restoreDeletedTask(taskId: string) {
  if (restoringDeletedTaskId.value) return
  restoringDeletedTaskId.value = taskId
  try {
    await props.restoreDeletedTask(taskId)
  } catch {
    // Global status already contains the API error.
  } finally {
    restoringDeletedTaskId.value = ''
  }
}

onBeforeUnmount(() => {
  if (scoreHighlightTimeout !== undefined) window.clearTimeout(scoreHighlightTimeout)
})
</script>

<template>
  <section class="priorities-screen" aria-label="Приоритеты">
    <div v-if="activeView === 'main'" class="priorities-shell">
      <header class="priorities-header">
        <div>
          <h1>Приоритеты</h1>
        </div>
        <span
          class="priorities-capacity"
          :aria-label="`Занято ${occupiedPrioritySlots} из ${totalPrioritySlots} мест`"
        >
          {{ occupiedPrioritySlots }}/{{ totalPrioritySlots }}
        </span>
      </header>

      <div class="priority-groups">
        <article
          v-for="group in groups"
          :key="group.id"
          class="priority-group"
        >
          <div class="priority-group-label">
            <span class="priority-number" :aria-label="`Группа ${group.id}`">{{ group.id }}</span>
          </div>

          <div class="priority-group-board">
            <div class="priority-task-list group-task-list">
              <div
                v-for="task in group.tasks"
                :key="task.id"
                :id="`priority-task-${task.id}`"
                :data-priority-task-id="task.id"
                class="priority-task"
                :class="{
                  editing: editingTaskId === task.id,
                  'score-updated': highlightedTaskId === task.id,
                }"
              >
                <input
                  class="priority-task-checkbox"
                  type="checkbox"
                  :checked="task.completed"
                  :aria-label="`Выполнить задачу: ${task.title}`"
                  @click.stop
                  @mousedown.stop
                  @change="completeTask(task.id)"
                />
                <form
                  v-if="editingTaskId === task.id"
                  class="priority-task-title-form"
                  @click.stop
                  @mousedown.stop
                  @submit.prevent="saveTaskTitle(task)"
                >
                  <input
                    v-model="editingTaskTitle"
                    :data-priority-title-edit="task.id"
                    type="text"
                    maxlength="255"
                    autocomplete="off"
                    :aria-label="`Название задачи: ${task.title}`"
                    :disabled="savingTaskId === task.id"
                    @blur="saveTaskTitle(task)"
                    @keydown.esc.prevent="cancelTaskTitleEdit"
                  />
                </form>
                <button
                  v-else
                  class="priority-task-title"
                  type="button"
                  :aria-label="`Редактировать задачу: ${task.title}`"
                  @click.stop="startTaskTitleEdit(task, $event)"
                  @mousedown.stop
                >
                  <PriorityTaskTitleDisplay :title="task.title" />
                </button>
                <PriorityTaskScore :task="task" :adjust-score="adjustTaskScore" />
                <button
                  class="priority-task-delete"
                  type="button"
                  :disabled="deletingTaskId === task.id"
                  :aria-label="`Удалить задачу: ${task.title}`"
                  title="Удалить задачу"
                  @click.stop.prevent="deleteTask(task.id)"
                  @mousedown.stop
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>

              <div v-if="group.tasks.length < group.limit" class="priority-empty-slot">
                Осталось {{ group.limit - group.tasks.length }}/{{ group.limit }} задач
              </div>
            </div>
          </div>
        </article>
      </div>

      <article class="priority-group inbox-group">
        <header class="priority-group-header">
          <span class="priority-number inbox-number"><Inbox aria-hidden="true" /></span>
          <div class="priority-group-heading">
            <strong>Входящие</strong>
            <span>Все нераспределённые задачи</span>
          </div>
          <span class="priority-counter">{{ inboxTasks.length }}</span>
        </header>

        <form class="priority-add-form inbox-add-form" @submit.prevent="submitInboxTask">
          <input
            v-model="inboxDraft"
            type="text"
            maxlength="255"
            autocomplete="off"
            placeholder="Добавить задачу во Входящие…"
          />
          <button type="submit" :disabled="submittingInbox">
            {{ submittingInbox ? 'Сохраняю…' : 'Добавить' }}
          </button>
        </form>

        <div class="priority-task-list">
          <div
            v-for="(task, index) in inboxTasks"
            :key="task.id"
            :id="`priority-task-${task.id}`"
            :data-priority-task-id="task.id"
            class="priority-task"
            :class="[
              inboxDropClass(task.id),
              {
                dragging: draggedInboxTaskId === task.id,
                editing: editingTaskId === task.id,
                'score-updated': highlightedTaskId === task.id,
              },
            ]"
            :draggable="editingTaskId !== task.id"
            @dragstart="startInboxTaskDrag($event, task.id)"
            @dragend="resetInboxDrag"
            @dragover="allowInboxTaskDrop($event, task.id)"
            @drop="dropOnInboxTask($event, task.id, index)"
          >
            <GripVertical class="priority-task-grip" aria-hidden="true" />
            <input
              class="priority-task-checkbox"
              type="checkbox"
              draggable="false"
              :checked="task.completed"
              :aria-label="`Выполнить задачу: ${task.title}`"
              @click.stop
              @mousedown.stop
              @dragstart.stop.prevent
              @change="completeTask(task.id)"
            />
            <form
              v-if="editingTaskId === task.id"
              class="priority-task-title-form"
              @click.stop
              @mousedown.stop
              @submit.prevent="saveTaskTitle(task)"
              @dragstart.stop.prevent
            >
              <input
                v-model="editingTaskTitle"
                :data-priority-title-edit="task.id"
                type="text"
                maxlength="255"
                autocomplete="off"
                :aria-label="`Название задачи: ${task.title}`"
                :disabled="savingTaskId === task.id"
                @blur="saveTaskTitle(task)"
                @keydown.esc.prevent="cancelTaskTitleEdit"
              />
            </form>
            <button
              v-else
              class="priority-task-title"
              type="button"
              draggable="false"
              :aria-label="`Редактировать задачу: ${task.title}`"
              @click.stop="startTaskTitleEdit(task, $event)"
              @mousedown.stop
              @dragstart.stop.prevent
            >
              <PriorityTaskTitleDisplay :title="task.title" />
            </button>
            <PriorityTaskScore :task="task" :adjust-score="adjustTaskScore" />
            <button
              class="priority-task-delete"
              type="button"
              draggable="false"
              :disabled="deletingTaskId === task.id"
              :aria-label="`Удалить задачу: ${task.title}`"
              title="Удалить задачу"
              @click.stop.prevent="deleteTask(task.id)"
              @mousedown.stop
              @dragstart.stop.prevent
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
          <div v-if="inboxTasks.length === 0" class="priority-empty-slot">
            Здесь появятся новые и возвращённые задачи
          </div>
        </div>
      </article>

      <button class="completed-link" type="button" @click="activeView = 'completed'">
        <span class="completed-link-icon"><CheckCircle2 aria-hidden="true" /></span>
        <span class="completed-link-copy">
          <strong>Выполненные</strong>
          <small>{{ taskCountLabel(completedTasks.length) }}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>

      <button class="completed-link trash-link" type="button" @click="activeView = 'trash'">
        <span class="completed-link-icon trash-link-icon"><Trash2 aria-hidden="true" /></span>
        <span class="completed-link-copy">
          <strong>Корзина</strong>
          <small>{{ taskCountLabel(trashedTasks.length) }}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>

    <div v-else-if="activeView === 'completed'" class="priorities-shell completed-shell">
      <header class="priorities-header completed-header">
        <button class="back-button" type="button" @click="activeView = 'main'">
          <ChevronLeft aria-hidden="true" />
          Приоритеты
        </button>
        <div>
          <h1>Выполненные</h1>
          <p>Сними отметку, чтобы вернуть задачу во «Входящие».</p>
        </div>
        <span class="priorities-capacity">{{ completedTasks.length }}</span>
      </header>

      <div class="completed-list">
        <label v-for="task in completedTasks" :key="task.id" class="completed-task">
          <input
            type="checkbox"
            checked
            :aria-label="`Вернуть задачу во Входящие: ${task.title}`"
            @change="restoreTask(task.id)"
          />
          <PriorityTaskTitleDisplay :title="task.title" />
        </label>
        <div v-if="completedTasks.length === 0" class="completed-empty">
          <CheckCircle2 aria-hidden="true" />
          <strong>Здесь пока пусто</strong>
          <span>Выполненные задачи будут собираться в этом разделе.</span>
        </div>
      </div>
    </div>

    <div v-else class="priorities-shell completed-shell">
      <header class="priorities-header completed-header">
        <button class="back-button" type="button" @click="activeView = 'main'">
          <ChevronLeft aria-hidden="true" />
          Приоритеты
        </button>
        <div>
          <h1>Корзина</h1>
          <p>Удалённые задачи можно восстановить.</p>
        </div>
        <span class="priorities-capacity">{{ trashedTasks.length }}</span>
      </header>

      <div class="completed-list trash-list">
        <div v-for="task in trashedTasks" :key="task.id" class="trash-task">
          <span class="trash-task-copy">
            <strong><PriorityTaskTitleDisplay :title="task.title" /></strong>
            <small v-if="deletionTimeLabel(task.deletedAt)">
              Удалена {{ deletionTimeLabel(task.deletedAt) }}
            </small>
          </span>
          <button
            type="button"
            class="trash-restore-button"
            :disabled="restoringDeletedTaskId === task.id"
            :aria-label="`Восстановить задачу: ${task.title}`"
            @click="restoreDeletedTask(task.id)"
          >
            <RotateCcw aria-hidden="true" />
            {{ restoringDeletedTaskId === task.id ? 'Восстанавливаю…' : 'Восстановить' }}
          </button>
        </div>
        <div v-if="trashedTasks.length === 0" class="completed-empty trash-empty">
          <Trash2 aria-hidden="true" />
          <strong>Корзина пуста</strong>
          <span>Удалённые задачи будут храниться здесь.</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.priorities-screen {
  flex: 1;
  min-width: 0;
  min-height: 100vh;
  margin-left: 72px;
  background: #f3f4f6;
  padding: 28px 28px 80px;
}

.priorities-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.priorities-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
}

.priorities-header h1 {
  margin: 0;
  color: #242a31;
  font-size: 28px;
  line-height: 1.15;
  font-weight: 780;
  letter-spacing: -0.02em;
}

.priorities-header p {
  margin: 6px 0 0;
  color: #687489;
  font-size: 13px;
  line-height: 1.5;
}

.priorities-capacity {
  flex: 0 0 auto;
  border-radius: 999px;
  background: #e4e8ef;
  color: #485568;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
}

.priority-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.priority-group {
  border: 1px solid #e0e5ed;
  border-radius: 12px;
  background: #fff;
  padding: 10px;
}

.priority-groups > .priority-group {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
}

.priority-group-board {
  min-width: 0;
  border: 1px solid #e0e5ed;
  border-radius: 12px;
  background: #fff;
  padding: 6px;
}

.priority-group-label {
  display: flex;
  padding-top: 7px;
}

.priority-group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
}

.priority-number {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 9px;
  background: #d6e4fb;
  color: #1f3b67;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
}

.priority-group:first-child .priority-number {
  background: #1f3b67;
  color: #fff;
}

.priority-group-heading {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.priority-group-heading strong {
  color: #303844;
  font-size: 14px;
  line-height: 1.2;
}

.priority-group-heading span {
  color: #8994a6;
  font-size: 11px;
  line-height: 1.2;
}

.priority-counter {
  min-width: 36px;
  border-radius: 999px;
  background: #f0f2f6;
  color: #667287;
  padding: 4px 8px;
  text-align: center;
  font-size: 11px;
  font-weight: 750;
}

.priority-add-form {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 2px 42px;
}

.priority-add-form input {
  min-width: 0;
  flex: 1;
  height: 34px;
  border: 1px solid #cfd7e3;
  border-radius: 8px;
  background: #fff;
  color: #303844;
  padding: 0 10px;
  font: inherit;
}

.priority-add-form input:focus-visible {
  outline: 2px solid #8fb1ff;
  outline-offset: 1px;
  border-color: #8fb1ff;
}

.priority-add-form button {
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: #1f3b67;
  color: #fff;
  padding: 0 12px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}

.priority-add-form button:disabled {
  opacity: 0.6;
  cursor: default;
}

.priority-task-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 7px;
}

.group-task-list {
  margin-top: 0;
}

.group-task-list .priority-task {
  padding-left: 10px;
}

.priority-task {
  position: relative;
  min-height: 36px;
  border-radius: 8px;
  background: #f4f6f9;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 40px 5px 5px;
  cursor: default;
  transition: background-color 120ms ease-out, opacity 120ms ease-out;
}

.priority-task:hover,
.priority-task:focus-within {
  background: #ebeff5;
}

.inbox-group .priority-task:not(.editing) {
  cursor: grab;
}

.inbox-group .priority-task:not(.editing):active {
  cursor: grabbing;
}

.priority-task.dragging {
  opacity: 0.42;
}

.priority-task.drop-before::before,
.priority-task.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  border-radius: 999px;
  background: #5382dd;
}

.priority-task.drop-before::before {
  top: -3px;
}

.priority-task.drop-after::after {
  bottom: -3px;
}

.priority-task-grip {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: #a3adba;
}

.priority-task.score-updated {
  animation: priority-task-score-highlight 1.4s ease-out;
}

@keyframes priority-task-score-highlight {
  0%,
  28% {
    background-color: #dbeafe;
    box-shadow: 0 0 0 2px rgba(83, 130, 221, 0.22);
  }

  100% {
    background-color: #f4f6f9;
    box-shadow: 0 0 0 0 rgba(83, 130, 221, 0);
  }
}

.completed-task {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}

.priority-task-checkbox,
.completed-task input {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  margin: 0;
  accent-color: #1f3b67;
}

.completed-task span {
  min-width: 0;
  color: #38414b;
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.priority-task-checkbox {
  border-radius: 8px;
  cursor: pointer;
}

.priority-task-title,
.priority-task-title-form {
  min-width: 0;
  flex: 1;
}

.priority-task-title {
  border: 0;
  background: transparent;
  color: #38414b;
  padding: 0;
  cursor: text;
  text-align: left;
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.priority-task-title-form {
  display: flex;
}

.priority-task-title-form input {
  width: 100%;
  min-width: 0;
  height: 26px;
  border: 1px solid #8fb1ff;
  border-radius: 6px;
  background: #fff;
  color: #303844;
  padding: 2px 7px;
  font: inherit;
  font-size: 13px;
}

.priority-task-title-form input:focus-visible {
  outline: 2px solid rgba(83, 130, 221, 0.22);
  outline-offset: 1px;
}

.priority-task.editing {
  cursor: default;
}

.priority-task-delete {
  position: absolute;
  top: 5px;
  right: 7px;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #98a3b2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition:
    opacity 120ms ease-out,
    background-color 120ms ease-out,
    color 120ms ease-out;
}

.priority-task:hover .priority-task-delete,
.priority-task:focus-within .priority-task-delete {
  opacity: 1;
  pointer-events: auto;
}

.priority-task-delete:hover:not(:disabled) {
  background: #fbe8e8;
  color: #b84b4b;
}

.priority-task-delete:disabled {
  opacity: 0.45;
  cursor: default;
}

.priority-task-delete svg {
  width: 15px;
  height: 15px;
}

.priority-empty-slot {
  min-height: 34px;
  border: 1px dashed #d8dee8;
  border-radius: 8px;
  color: #9aa4b3;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 7px 12px;
  text-align: center;
  font-size: 11px;
}

.inbox-group {
  margin-top: 18px;
  border-color: #d7dee9;
}

.inbox-number {
  background: #e4e8ef;
  color: #4b596d;
}

.inbox-number svg {
  width: 17px;
  height: 17px;
}

.inbox-add-form {
  margin-left: 0;
}

.completed-link {
  width: 100%;
  min-height: 58px;
  margin-top: 10px;
  border: 1px solid #e0e5ed;
  border-radius: 12px;
  background: #fff;
  color: #3b4656;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease-out, border-color 120ms ease-out;
}

.completed-link:hover {
  background: #f8fafc;
  border-color: #cfd8e4;
}

.completed-link-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: #e8f3ec;
  color: #397851;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.completed-link-icon svg,
.completed-link > svg {
  width: 17px;
  height: 17px;
}

.trash-link-icon {
  background: #f6ecec;
  color: #a35d5d;
}

.completed-link-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.completed-link-copy strong {
  font-size: 13px;
}

.completed-link-copy small {
  color: #8994a6;
  font-size: 11px;
}

.completed-header {
  display: grid;
  grid-template-columns: 1fr auto;
}

.back-button {
  grid-column: 1 / -1;
  width: max-content;
  border: 0;
  background: transparent;
  color: #5f6e83;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 14px -6px;
  padding: 4px 6px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
}

.back-button svg {
  width: 15px;
  height: 15px;
}

.completed-list {
  border: 1px solid #e0e5ed;
  border-radius: 12px;
  background: #fff;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.completed-task {
  min-height: 38px;
  border-radius: 8px;
  background: #f4f6f9;
  padding: 7px 10px;
}

.completed-task:hover {
  background: #ebeff5;
}

.completed-task span {
  color: #7f8998;
  text-decoration: line-through;
}

.completed-empty {
  min-height: 220px;
  color: #8994a6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  text-align: center;
}

.completed-empty svg {
  width: 28px;
  height: 28px;
  color: #7da28a;
}

.completed-empty strong {
  color: #566174;
  font-size: 14px;
}

.completed-empty span {
  font-size: 12px;
}

.trash-task {
  min-height: 48px;
  border-radius: 8px;
  background: #f4f6f9;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 9px 7px 12px;
}

.trash-task-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trash-task-copy strong {
  overflow: hidden;
  color: #465164;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-task-copy small {
  color: #909aaa;
  font-size: 10px;
}

.trash-restore-button {
  flex: 0 0 auto;
  min-height: 30px;
  border: 1px solid #d9e1eb;
  border-radius: 7px;
  background: #fff;
  color: #52637a;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
}

.trash-restore-button:hover:not(:disabled) {
  border-color: #afc0d7;
  background: #f8fafc;
}

.trash-restore-button:disabled {
  opacity: 0.55;
  cursor: default;
}

.trash-restore-button svg {
  width: 14px;
  height: 14px;
}

.trash-empty svg {
  color: #a98383;
}

button:focus-visible,
.priority-task-title-form input:focus-visible,
.completed-task:focus-within {
  outline: 2px solid #8fb1ff;
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .priorities-screen {
    margin-left: 0;
    padding: 72px 14px 56px;
  }

  .priorities-header {
    gap: 12px;
  }

  .priorities-header h1 {
    font-size: 24px;
  }

  .priority-add-form {
    margin-left: 0;
  }

  .priority-groups > .priority-group {
    grid-template-columns: 32px minmax(0, 1fr);
    gap: 8px;
  }

  .priority-task {
    flex-wrap: wrap;
  }

  .trash-task {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (hover: none) {
  .priority-task-delete {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .priority-task,
  .completed-link {
    transition: none;
  }

  .priority-task.score-updated {
    animation: none;
    background-color: #dbeafe;
    box-shadow: 0 0 0 2px rgba(83, 130, 221, 0.22);
  }
}
</style>
