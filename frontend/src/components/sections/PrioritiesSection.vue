<script setup lang="ts">
import { CheckCircle2, ChevronLeft, ChevronRight, GripVertical, Inbox, Plus } from '@lucide/vue'
import { nextTick, reactive, ref } from 'vue'

import type { PriorityGroupView } from '@/app/priority-task-state'
import type { PriorityGroup, TaskItem } from '@/lib/app-state'

type PriorityLocation = PriorityGroup | null

const props = defineProps<{
  groups: PriorityGroupView[]
  inboxTasks: TaskItem[]
  completedTasks: TaskItem[]
  addTask: (title: string, group: PriorityLocation) => Promise<unknown>
  moveTask: (taskId: string, group: PriorityLocation, targetIndex: number) => Promise<void>
  completeTask: (taskId: string) => Promise<void>
  restoreTask: (taskId: string) => Promise<void>
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
  if (!task || !group) return false
  return task.priorityGroup === location || group.tasks.length < group.limit
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
</script>

<template>
  <section class="priorities-screen" aria-label="Приоритеты">
    <div v-if="!showCompleted" class="priorities-shell">
      <header class="priorities-header">
        <div>
          <h1>Приоритеты</h1>
          <p>Чем выше группа, тем меньше в ней мест и тем важнее каждая задача.</p>
        </div>
        <span class="priorities-capacity">45 мест</span>
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
          <header class="priority-group-header">
            <span class="priority-number" :aria-label="`Группа ${group.id}`">{{ group.id }}</span>
            <div class="priority-group-heading">
              <strong>Группа {{ group.id }}</strong>
              <span>{{ group.id === 1 ? 'Максимальный приоритет' : `До ${group.limit} задач` }}</span>
            </div>
            <span class="priority-counter" :class="{ full: group.tasks.length >= group.limit }">
              {{ group.tasks.length }} / {{ group.limit }}
            </span>
            <button
              class="priority-add-button"
              type="button"
              :disabled="group.tasks.length >= group.limit"
              :aria-label="`Добавить задачу в группу ${group.id}`"
              :title="group.tasks.length >= group.limit ? 'Группа заполнена' : 'Добавить задачу'"
              @click="openGroupAdd(group.id)"
            >
              <Plus aria-hidden="true" />
            </button>
          </header>

          <form
            v-if="groupAddOpen === group.id"
            class="priority-add-form"
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

          <div class="priority-task-list">
            <div
              v-for="(task, index) in group.tasks"
              :key="task.id"
              class="priority-task"
              :class="[rowDropClass(task.id), { dragging: draggedTaskId === task.id }]"
              draggable="true"
              @dragstart="startDrag($event, task.id)"
              @dragend="resetDrag"
              @dragover="allowTaskDrop($event, group.id, task.id)"
              @drop="dropOnTask($event, group.id, task.id, index)"
            >
              <GripVertical class="priority-task-grip" aria-hidden="true" />
              <label class="priority-task-check">
                <input
                  type="checkbox"
                  :checked="task.completed"
                  :aria-label="`Выполнить задачу: ${task.title}`"
                  @change="completeTask(task.id)"
                />
                <span>{{ task.title }}</span>
              </label>
            </div>

            <div v-if="group.tasks.length === 0" class="priority-empty-slot">
              Перетащи задачу сюда или добавь новую
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
            class="priority-task"
            :class="[rowDropClass(task.id), { dragging: draggedTaskId === task.id }]"
            draggable="true"
            @dragstart="startDrag($event, task.id)"
            @dragend="resetDrag"
            @dragover="allowTaskDrop($event, null, task.id)"
            @drop="dropOnTask($event, null, task.id, index)"
          >
            <GripVertical class="priority-task-grip" aria-hidden="true" />
            <label class="priority-task-check">
              <input
                type="checkbox"
                :checked="task.completed"
                :aria-label="`Выполнить задачу: ${task.title}`"
                @change="completeTask(task.id)"
              />
              <span>{{ task.title }}</span>
            </label>
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

.priority-group.drop-active {
  border-color: #8fb1ff;
  background: #f7faff;
  box-shadow: 0 0 0 3px rgba(143, 177, 255, 0.16);
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

.priority-counter.full {
  background: #e4e8ef;
  color: #3d495a;
}

.priority-add-button {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: #eff1f5;
  color: #526177;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 120ms ease-out, transform 90ms ease-out;
}

.priority-add-button:hover:not(:disabled) {
  background: #dfe6f0;
}

.priority-add-button:active:not(:disabled) {
  transform: scale(0.97);
}

.priority-add-button:disabled {
  cursor: default;
  opacity: 0.38;
}

.priority-add-button svg {
  width: 16px;
  height: 16px;
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

.priority-task {
  position: relative;
  min-height: 36px;
  border-radius: 8px;
  background: #f4f6f9;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px 5px 5px;
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

.priority-task-check,
.completed-task {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}

.priority-task-check input,
.completed-task input {
  width: 17px;
  height: 17px;
  flex: 0 0 17px;
  margin: 0;
  accent-color: #1f3b67;
}

.priority-task-check span,
.completed-task span {
  min-width: 0;
  color: #38414b;
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
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
.priority-task-check:focus-within,
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
}

@media (prefers-reduced-motion: reduce) {
  .priority-group,
  .priority-task,
  .priority-add-button,
  .completed-link {
    transition: none;
  }
}
</style>
