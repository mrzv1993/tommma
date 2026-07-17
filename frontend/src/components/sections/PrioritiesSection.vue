<script setup lang="ts">
import { CheckCircle2, ChevronLeft, ChevronRight, GripVertical, Inbox, Trash2 } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue'

import type { PriorityGroupView } from '@/app/priority-task-state'
import PriorityTaskScore from '@/components/sections/PriorityTaskScore.vue'
import type { PriorityGroup, TaskItem } from '@/lib/app-state'

type PriorityLocation = PriorityGroup | null

const SCORE_HIGHLIGHT_DURATION_MS = 1400

const props = defineProps<{
  groups: PriorityGroupView[]
  inboxTasks: TaskItem[]
  completedTasks: TaskItem[]
  addTask: (title: string, group: PriorityLocation) => Promise<unknown>
  adjustScore: (
    taskId: string,
    field: 'importance' | 'urgency',
    delta: -1 | 1,
  ) => Promise<void>
  moveTask: (taskId: string, group: PriorityLocation, targetIndex: number) => Promise<void>
  removeTask: (taskId: string) => Promise<void>
  completeTask: (taskId: string) => Promise<void>
  restoreTask: (taskId: string) => Promise<void>
  updateTaskTitle: (taskId: string, title: string) => Promise<void>
}>()

const showCompleted = ref(false)
const groupAddOpen = ref<PriorityGroup | null>(null)
const drafts = reactive<Record<string, string>>({ inbox: '' })
const submittingLocation = ref('')
const draggedTaskId = ref('')
const dropTargetId = ref('')
const dropPlacement = ref<'before' | 'after'>('before')
const activeDropLocation = ref('')
const blockedDropLocation = ref('')
const editingTaskId = ref('')
const editingTaskTitle = ref('')
const savingTaskId = ref('')
const deletingTaskId = ref('')
const highlightedTaskId = ref('')
let scoreHighlightTimeout: number | undefined
const occupiedPrioritySlots = computed(() =>
  props.groups.reduce((total, group) => total + group.tasks.length, 0),
)
const totalPrioritySlots = computed(() =>
  props.groups.reduce((total, group) => total + group.limit, 0),
)

function locationKey(location: PriorityLocation) {
  return location === null ? 'inbox' : `group-${location}`
}

function tasksForLocation(location: PriorityLocation) {
  if (location === null) return props.inboxTasks
  return props.groups.find((group) => group.id === location)?.tasks ?? []
}

function draggedTask() {
  return [...props.inboxTasks, ...props.groups.flatMap((group) => group.tasks)].find(
    (task) => task.id === draggedTaskId.value,
  )
}

function canDropInto(location: PriorityLocation) {
  if (location === null) return true
  const task = draggedTask()
  const group = props.groups.find((item) => item.id === location)
  return Boolean(task && group)
}

async function openGroupAdd(group: PriorityGroup) {
  const current = props.groups.find((item) => item.id === group)
  if (!current || current.tasks.length >= current.limit) return
  groupAddOpen.value = group
  await nextTick()
  document.querySelector<HTMLInputElement>(`input[data-priority-add="group-${group}"]`)?.focus()
}

function closeGroupAdd(group: PriorityGroup) {
  drafts[locationKey(group)] = ''
  if (groupAddOpen.value === group) groupAddOpen.value = null
}

async function submitTask(location: PriorityLocation) {
  const key = locationKey(location)
  const title = (drafts[key] || '').trim()
  if (!title || submittingLocation.value) return
  submittingLocation.value = key
  try {
    await props.addTask(title, location)
    drafts[key] = ''
    if (location !== null) groupAddOpen.value = null
  } catch {
    // Global status already contains the API error; keep the draft for retry.
  } finally {
    submittingLocation.value = ''
  }
}

function startDrag(event: DragEvent, taskId: string) {
  draggedTaskId.value = taskId
  event.dataTransfer?.setData('application/x-tommma-priority-task', taskId)
  event.dataTransfer?.setData('text/plain', taskId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function setDraggedTaskFromEvent(event: DragEvent) {
  if (draggedTaskId.value) return
  draggedTaskId.value =
    event.dataTransfer?.getData('application/x-tommma-priority-task') ||
    event.dataTransfer?.getData('text/plain') ||
    ''
}

function allowLocationDrop(event: DragEvent, location: PriorityLocation) {
  setDraggedTaskFromEvent(event)
  event.preventDefault()
  const key = locationKey(location)
  if (!canDropInto(location)) {
    blockedDropLocation.value = key
    activeDropLocation.value = ''
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }
  blockedDropLocation.value = ''
  activeDropLocation.value = key
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function allowTaskDrop(event: DragEvent, location: PriorityLocation, taskId: string) {
  allowLocationDrop(event, location)
  if (!canDropInto(location)) return
  const row = event.currentTarget as HTMLElement
  const bounds = row.getBoundingClientRect()
  dropTargetId.value = taskId
  dropPlacement.value = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

function normalizedTargetIndex(location: PriorityLocation, requestedIndex: number) {
  const list = tasksForLocation(location)
  const sourceIndex = list.findIndex((task) => task.id === draggedTaskId.value)
  if (sourceIndex >= 0 && sourceIndex < requestedIndex) return Math.max(0, requestedIndex - 1)
  return requestedIndex
}

async function dropAtEnd(event: DragEvent, location: PriorityLocation) {
  event.preventDefault()
  setDraggedTaskFromEvent(event)
  if (!draggedTaskId.value || !canDropInto(location)) {
    resetDrag()
    return
  }
  const targetIndex = normalizedTargetIndex(location, tasksForLocation(location).length)
  const taskId = draggedTaskId.value
  resetDrag()
  await props.moveTask(taskId, location, targetIndex)
}

async function dropOnTask(event: DragEvent, location: PriorityLocation, targetTaskId: string, index: number) {
  event.preventDefault()
  event.stopPropagation()
  setDraggedTaskFromEvent(event)
  if (!draggedTaskId.value || !canDropInto(location)) {
    resetDrag()
    return
  }
  const requestedIndex = index + (dropPlacement.value === 'after' ? 1 : 0)
  const targetIndex = normalizedTargetIndex(location, requestedIndex)
  const taskId = draggedTaskId.value
  if (taskId === targetTaskId) {
    resetDrag()
    return
  }
  resetDrag()
  await props.moveTask(taskId, location, targetIndex)
}

function resetDrag() {
  draggedTaskId.value = ''
  dropTargetId.value = ''
  activeDropLocation.value = ''
  blockedDropLocation.value = ''
  dropPlacement.value = 'before'
}

function rowDropClass(taskId: string) {
  if (dropTargetId.value !== taskId) return ''
  return dropPlacement.value === 'before' ? 'drop-before' : 'drop-after'
}

function taskCountLabel(count: number) {
  const mod100 = count % 100
  const mod10 = count % 10
  if (mod100 >= 11 && mod100 <= 14) return `${count} задач`
  if (mod10 === 1) return `${count} задача`
  if (mod10 >= 2 && mod10 <= 4) return `${count} задачи`
  return `${count} задач`
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

onBeforeUnmount(() => {
  if (scoreHighlightTimeout !== undefined) window.clearTimeout(scoreHighlightTimeout)
})
</script>

<template>
  <section class="priorities-screen" aria-label="Приоритеты">
    <div v-if="!showCompleted" class="priorities-shell">
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
          :class="{
            'drop-active': activeDropLocation === locationKey(group.id),
            'drop-blocked': blockedDropLocation === locationKey(group.id),
          }"
          @dragover="allowLocationDrop($event, group.id)"
          @drop="dropAtEnd($event, group.id)"
        >
          <div class="priority-group-label">
            <span class="priority-number" :aria-label="`Группа ${group.id}`">{{ group.id }}</span>
          </div>

          <div class="priority-group-board">
            <div class="priority-task-list group-task-list">
              <div
                v-for="(task, index) in group.tasks"
                :key="task.id"
                :id="`priority-task-${task.id}`"
                :data-priority-task-id="task.id"
                class="priority-task"
                :class="[
                  rowDropClass(task.id),
                  {
                    dragging: draggedTaskId === task.id,
                    editing: editingTaskId === task.id,
                    'score-updated': highlightedTaskId === task.id,
                  },
                ]"
                :draggable="editingTaskId !== task.id"
                @dragstart="startDrag($event, task.id)"
                @dragend="resetDrag"
                @dragover="allowTaskDrop($event, group.id, task.id)"
                @drop="dropOnTask($event, group.id, task.id, index)"
              >
                <GripVertical class="priority-task-grip" aria-hidden="true" />
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
                  draggable="false"
                  :aria-label="`Редактировать задачу: ${task.title}`"
                  @click.stop="startTaskTitleEdit(task, $event)"
                  @mousedown.stop
                  @dragstart.prevent.stop
                >
                  {{ task.title }}
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
                  @dragstart.prevent.stop
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>

              <form
                v-if="groupAddOpen === group.id && group.tasks.length < group.limit"
                class="priority-add-form group-add-form"
                @submit.prevent="submitTask(group.id)"
              >
                <input
                  v-model="drafts[locationKey(group.id)]"
                  :data-priority-add="locationKey(group.id)"
                  type="text"
                  maxlength="255"
                  autocomplete="off"
                  placeholder="Новая задача…"
                  @keydown.esc.prevent="closeGroupAdd(group.id)"
                />
                <button type="submit" :disabled="submittingLocation === locationKey(group.id)">
                  {{ submittingLocation === locationKey(group.id) ? 'Сохраняю…' : 'Добавить' }}
                </button>
              </form>

              <button
                v-else-if="group.tasks.length < group.limit"
                class="priority-add-zone"
                type="button"
                :aria-label="`Добавить задачу в группу ${group.id}`"
                @click="openGroupAdd(group.id)"
                @dragover.stop="allowLocationDrop($event, group.id)"
                @drop.stop="dropAtEnd($event, group.id)"
              >
                Перетащи задачу сюда или добавь новую
              </button>
            </div>
          </div>
        </article>
      </div>

      <article
        class="priority-group inbox-group"
        :class="{ 'drop-active': activeDropLocation === 'inbox' }"
        @dragover="allowLocationDrop($event, null)"
        @drop="dropAtEnd($event, null)"
      >
        <header class="priority-group-header">
          <span class="priority-number inbox-number"><Inbox aria-hidden="true" /></span>
          <div class="priority-group-heading">
            <strong>Входящие</strong>
            <span>Все нераспределённые задачи</span>
          </div>
          <span class="priority-counter">{{ inboxTasks.length }}</span>
        </header>

        <form class="priority-add-form inbox-add-form" @submit.prevent="submitTask(null)">
          <input
            v-model="drafts.inbox"
            type="text"
            maxlength="255"
            autocomplete="off"
            placeholder="Добавить задачу во Входящие…"
          />
          <button type="submit" :disabled="submittingLocation === 'inbox'">
            {{ submittingLocation === 'inbox' ? 'Сохраняю…' : 'Добавить' }}
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
              rowDropClass(task.id),
              {
                dragging: draggedTaskId === task.id,
                editing: editingTaskId === task.id,
                'score-updated': highlightedTaskId === task.id,
              },
            ]"
            :draggable="editingTaskId !== task.id"
            @dragstart="startDrag($event, task.id)"
            @dragend="resetDrag"
            @dragover="allowTaskDrop($event, null, task.id)"
            @drop="dropOnTask($event, null, task.id, index)"
          >
            <GripVertical class="priority-task-grip" aria-hidden="true" />
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
              draggable="false"
              :aria-label="`Редактировать задачу: ${task.title}`"
              @click.stop="startTaskTitleEdit(task, $event)"
              @mousedown.stop
              @dragstart.prevent.stop
            >
              {{ task.title }}
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
              @dragstart.prevent.stop
            >
              <Trash2 aria-hidden="true" />
            </button>
          </div>
          <div v-if="inboxTasks.length === 0" class="priority-empty-slot">
            Здесь появятся новые и возвращённые задачи
          </div>
        </div>
      </article>

      <button class="completed-link" type="button" @click="showCompleted = true">
        <span class="completed-link-icon"><CheckCircle2 aria-hidden="true" /></span>
        <span class="completed-link-copy">
          <strong>Выполненные</strong>
          <small>{{ taskCountLabel(completedTasks.length) }}</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>

    <div v-else class="priorities-shell completed-shell">
      <header class="priorities-header completed-header">
        <button class="back-button" type="button" @click="showCompleted = false">
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
          <span>{{ task.title }}</span>
        </label>
        <div v-if="completedTasks.length === 0" class="completed-empty">
          <CheckCircle2 aria-hidden="true" />
          <strong>Здесь пока пусто</strong>
          <span>Выполненные задачи будут собираться в этом разделе.</span>
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
  width: min(860px, 100%);
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
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background-color 120ms ease-out;
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

.priority-group.drop-active {
  border-color: #8fb1ff;
  background: #f7faff;
  box-shadow: 0 0 0 3px rgba(143, 177, 255, 0.16);
}

.priority-groups > .priority-group.drop-active,
.priority-groups > .priority-group.drop-blocked {
  background: transparent;
  box-shadow: none;
}

.priority-group-board {
  min-width: 0;
  border: 1px solid #e0e5ed;
  border-radius: 12px;
  background: #fff;
  padding: 6px;
  transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background-color 120ms ease-out;
}

.priority-groups > .priority-group.drop-active .priority-group-board {
  border-color: #8fb1ff;
  background: #f7faff;
  box-shadow: 0 0 0 3px rgba(143, 177, 255, 0.16);
}

.priority-groups > .priority-group.drop-blocked .priority-group-board {
  border-color: #e7a0a0;
  background: #fff9f9;
  box-shadow: 0 0 0 3px rgba(214, 93, 93, 0.1);
}

.priority-group-label {
  display: flex;
  padding-top: 7px;
}

.priority-group.drop-blocked {
  border-color: #e7a0a0;
  background: #fff9f9;
  box-shadow: 0 0 0 3px rgba(214, 93, 93, 0.1);
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

.group-add-form {
  margin: 3px 0 0;
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
  cursor: grab;
  transition: background-color 120ms ease-out, opacity 120ms ease-out;
}

.priority-task:hover,
.priority-task:focus-within {
  background: #ebeff5;
}

.priority-task:active {
  cursor: grabbing;
}

.priority-task.dragging {
  opacity: 0.42;
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
  cursor: pointer;
  transition: background-color 120ms ease-out, color 120ms ease-out;
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

.priority-add-zone {
  width: 100%;
  min-height: 34px;
  border: 1px dashed #d8dee8;
  border-radius: 8px;
  background: transparent;
  color: #8793a5;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 7px 12px;
  cursor: pointer;
  text-align: center;
  font: inherit;
  font-size: 11px;
  transition: border-color 120ms ease-out, background-color 120ms ease-out, color 120ms ease-out;
}

.priority-add-zone:hover {
  border-color: #b9c7db;
  background: #f4f7fb;
  color: #53647c;
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
}


@media (prefers-reduced-motion: reduce) {
  .priority-group,
  .priority-group-board,
  .priority-task,
  .priority-add-zone,
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
