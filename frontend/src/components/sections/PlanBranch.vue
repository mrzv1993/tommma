<script setup lang="ts">
import { Maximize2, Trash } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import type { PlanStateElement } from '@/lib/api'

const PLAN_ELEMENT_MIN_HEIGHT = 40
const PLAN_PARENT_ELEMENT_MIN_HEIGHT = 80
const PLAN_COLUMN_MIN_WIDTH = 160
const PLAN_COLUMN_MAX_WIDTH = 1200
const PLAN_DRAG_DATA_TYPE = 'application/x-tommma-plan-element-id'
type DragPosition = 'before' | 'after'
type PointerDragState = {
  elementId: string
  columnId: string
  startX: number
  startY: number
  started: boolean
}

const props = defineProps<{
  elements: PlanStateElement[]
  columnDepth: number
  itemWidth: number
  columnWidths?: Record<string, number>
  branchColor?: string
  branchHeight: number
  isRoot?: boolean
  nextStepTaskIds?: string[]
  highlightedNextStepTaskIds?: string[]
}>()

const emit = defineEmits<{
  addSibling: [elementId: string]
  addChild: [elementId: string]
  delete: [elementId: string]
  rename: [elementId: string, title: string]
  reorder: [draggedId: string, targetId: string, position: DragPosition]
  select: [elementId: string]
  nextStepBadgeHover: [elementId: string]
  nextStepBadgeLeave: []
  expand: [elementId: string]
  resizeColumn: [columnId: string, width: number]
  toggleComplete: [elementId: string, completed: boolean]
}>()

const draggingElementId = ref('')
const dragOverElementId = ref('')
const dragOverPosition = ref<DragPosition>('before')
const editingElementId = ref('')
const titleDraft = ref('')
const completedTasksExpanded = ref(false)
let selectClickTimeout: number | null = null
let resizeCleanup: (() => void) | null = null
let pointerDragState: PointerDragState | null = null
let pointerDragCleanup: (() => void) | null = null
let suppressNextClick = false

const nextStepTaskIdSet = computed(() => new Set(props.nextStepTaskIds || []))
const highlightedNextStepTaskIdSet = computed(() => new Set(props.highlightedNextStepTaskIds || []))
const columnId = computed(() => `level-${props.columnDepth}`)
const currentItemWidth = computed(() =>
  Math.max(PLAN_COLUMN_MIN_WIDTH, props.columnWidths?.[columnId.value] || props.itemWidth),
)
const visibleElements = computed(() => props.elements.filter((element) => element.children?.length || !element.completed))
const completedTaskElements = computed(() => props.elements.filter((element) => !element.children?.length && element.completed))

function isTaskElement(element: PlanStateElement) {
  return element.type === 'task' || !element.children?.length
}

function activeBranchColor(element: PlanStateElement) {
  return props.isRoot ? element.color : props.branchColor
}

function branchAccentShadow(color: string | undefined) {
  return color ? `inset 0 0 0 2px ${color}33` : '0 0 0 0 transparent'
}

function branchInnerShadow(color: string | undefined) {
  return color ? `0 0 40px 0 ${color}2E inset` : undefined
}

function taskProgressRatio(element: PlanStateElement): number {
  if (!element.children?.length) {
    return element.completed ? 1 : 0
  }

  const totalProgress = element.children.reduce((total, child) => total + taskProgressRatio(child), 0)
  return totalProgress / element.children.length
}

function taskProgressPercent(element: PlanStateElement) {
  return Math.round(taskProgressRatio(element) * 100)
}

function collectTaskIds(element: PlanStateElement): string[] {
  if (!element.children?.length) return [element.id]
  return element.children.flatMap((child) => collectTaskIds(child))
}

function nextStepTaskCount(element: PlanStateElement) {
  return collectTaskIds(element).filter((taskId) => nextStepTaskIdSet.value.has(taskId)).length
}

function isNextStepPathHighlighted(element: PlanStateElement) {
  return collectTaskIds(element).some((taskId) => highlightedNextStepTaskIdSet.value.has(taskId))
}

function shouldShowNextStepBadge(element: PlanStateElement) {
  return props.isRoot && nextStepTaskCount(element) > 0
}

function nextStepBadgeText(element: PlanStateElement) {
  const count = nextStepTaskCount(element)
  return count > 1 ? `→${count}` : '→'
}

function requiredElementHeight(element: PlanStateElement): number {
  const childBranchHeight = requiredBranchHeight(element.children || [])
  const minHeight = element.children?.length ? PLAN_PARENT_ELEMENT_MIN_HEIGHT : PLAN_ELEMENT_MIN_HEIGHT
  return Math.max(minHeight, childBranchHeight)
}

function requiredBranchHeight(elements: PlanStateElement[]): number {
  if (elements.length === 1) {
    return requiredElementHeight(elements[0]) * 2
  }
  return elements.reduce((total, element) => total + requiredElementHeight(element), 0)
}

function elementLayoutHeight(element: PlanStateElement) {
  const completedSlotHeight = completedTaskElements.value.length ? PLAN_ELEMENT_MIN_HEIGHT : 0
  const requiredTotal = requiredBranchHeight(visibleElements.value) + completedSlotHeight
  const slotCount = visibleElements.value.length + (completedTaskElements.value.length ? 1 : 0)
  const slots = slotCount === 1 ? 2 : slotCount
  const extra = Math.max(0, props.branchHeight - requiredTotal)
  const distributedExtra = slotCount ? extra / slots : 0
  return requiredElementHeight(element) + distributedExtra
}

function completedCardHeight() {
  if (!completedTaskElements.value.length) return 0
  const completedSlotHeight = completedTasksExpanded.value
    ? Math.max(PLAN_ELEMENT_MIN_HEIGHT, 40 + completedTaskElements.value.length * 32)
    : PLAN_ELEMENT_MIN_HEIGHT
  const requiredTotal = requiredBranchHeight(visibleElements.value) + completedSlotHeight
  const slotCount = visibleElements.value.length + 1
  const slots = slotCount === 1 ? 2 : slotCount
  const extra = Math.max(0, props.branchHeight - requiredTotal)
  return completedSlotHeight + extra / slots
}

function shouldShowCardNote(element: PlanStateElement) {
  return Boolean(element.note?.trim()) && elementLayoutHeight(element) >= 120
}

function toggleCompletedTasksExpanded() {
  completedTasksExpanded.value = !completedTasksExpanded.value
}

function addSlotHeight() {
  const firstElement = visibleElements.value[0]
  return firstElement ? elementLayoutHeight(firstElement) : 0
}

function addSecondSlotElement() {
  const firstElement = visibleElements.value[0]
  if (!firstElement) return
  emit('addSibling', firstElement.id)
}

function titleInputId(elementId: string) {
  return `plan-title-editor-${elementId}`
}

function isDragControl(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button, input, .plan-column-resize-handle'))
}

function clampColumnWidth(width: number) {
  return Math.min(PLAN_COLUMN_MAX_WIDTH, Math.max(PLAN_COLUMN_MIN_WIDTH, Math.round(width)))
}

function startColumnResize(event: MouseEvent) {
  const startX = event.clientX
  const startWidth = currentItemWidth.value
  let didResize = false

  resizeCleanup?.()

  const onPointerMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX
    if (!didResize && Math.abs(delta) < 4) return
    didResize = true
    emit('resizeColumn', columnId.value, clampColumnWidth(startWidth + delta))
  }

  const onPointerUp = () => {
    resizeCleanup?.()
    resizeCleanup = null
  }

  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp, { once: true })
  resizeCleanup = () => {
    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
  }
}

function startInlineEdit(event: MouseEvent, element: PlanStateElement) {
  if (isDragControl(event.target)) return
  if (selectClickTimeout) {
    window.clearTimeout(selectClickTimeout)
    selectClickTimeout = null
  }
  emit('select', '')
  editingElementId.value = element.id
  titleDraft.value = element.title
  void nextTick(() => {
    const input = document.getElementById(titleInputId(element.id))
    if (input instanceof HTMLInputElement) {
      input.focus()
      input.select()
    }
  })
}

function commitInlineEdit(element: PlanStateElement) {
  if (editingElementId.value !== element.id) return
  const title = titleDraft.value.trim()
  editingElementId.value = ''
  titleDraft.value = ''
  if (!title || title === element.title) return
  emit('rename', element.id, title)
}

function cancelInlineEdit() {
  editingElementId.value = ''
  titleDraft.value = ''
}

function selectElement(event: MouseEvent, elementId: string) {
  if (isDragControl(event.target)) return
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (event.detail > 1) return
  if (selectClickTimeout) {
    window.clearTimeout(selectClickTimeout)
  }
  selectClickTimeout = window.setTimeout(() => {
    emit('select', elementId)
    selectClickTimeout = null
  }, 360)
}

function getDropPosition(event: DragEvent): DragPosition {
  const row = event.currentTarget
  if (!(row instanceof HTMLElement)) return 'after'
  const rect = row.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function getPointerDropPosition(event: PointerEvent, row: HTMLElement): DragPosition {
  const rect = row.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function getDraggedElementId(event: DragEvent) {
  return event.dataTransfer?.getData(PLAN_DRAG_DATA_TYPE) || event.dataTransfer?.getData('text/plain') || ''
}

function clearDragState() {
  draggingElementId.value = ''
  dragOverElementId.value = ''
}

function clearPointerDragState() {
  pointerDragCleanup?.()
  pointerDragCleanup = null
  pointerDragState = null
  document.body.style.userSelect = ''
  clearDragState()
}

function getPointerDragTarget(event: PointerEvent) {
  const state = pointerDragState
  if (!state) return null
  const hitElement = document.elementFromPoint(event.clientX, event.clientY)
  if (!(hitElement instanceof HTMLElement)) return null
  const row = hitElement.closest<HTMLElement>('.plan-branch-row[data-plan-element-id]')
  if (!row || row.dataset.planColumnId !== state.columnId) return null
  const targetId = row.dataset.planElementId || ''
  if (!targetId || targetId === state.elementId) return null
  return {
    targetId,
    position: getPointerDropPosition(event, row),
  }
}

function startPointerElementDrag(event: PointerEvent, elementId: string) {
  if (event.button !== 0 || isDragControl(event.target)) return
  pointerDragCleanup?.()
  pointerDragState = {
    elementId,
    columnId: columnId.value,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
  }

  const onPointerMove = (moveEvent: PointerEvent) => {
    const state = pointerDragState
    if (!state) return
    const distance = Math.hypot(moveEvent.clientX - state.startX, moveEvent.clientY - state.startY)
    if (!state.started && distance < 6) return
    if (!state.started) {
      state.started = true
      suppressNextClick = true
      draggingElementId.value = state.elementId
      document.body.style.userSelect = 'none'
    }
    moveEvent.preventDefault()
    const target = getPointerDragTarget(moveEvent)
    if (!target) {
      dragOverElementId.value = ''
      return
    }
    dragOverElementId.value = target.targetId
    dragOverPosition.value = target.position
  }

  const onPointerUp = (upEvent: PointerEvent) => {
    const state = pointerDragState
    if (state?.started) {
      upEvent.preventDefault()
      const target = getPointerDragTarget(upEvent)
      if (target && target.targetId !== state.elementId) {
        emit('reorder', state.elementId, target.targetId, target.position)
      }
    }
    clearPointerDragState()
  }

  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', clearPointerDragState, { once: true })
  pointerDragCleanup = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', clearPointerDragState)
  }
}

function startElementDrag(event: DragEvent, elementId: string) {
  if (isDragControl(event.target)) {
    event.preventDefault()
    return
  }
  draggingElementId.value = elementId
  event.dataTransfer?.setData(PLAN_DRAG_DATA_TYPE, elementId)
  event.dataTransfer?.setData('text/plain', elementId)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function updateDragTarget(event: DragEvent, targetId: string) {
  if (!draggingElementId.value || draggingElementId.value === targetId) {
    dragOverElementId.value = ''
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverElementId.value = targetId
  dragOverPosition.value = getDropPosition(event)
}

function dropElement(event: DragEvent, targetId: string) {
  event.preventDefault()
  const draggedId = getDraggedElementId(event)
  const position = getDropPosition(event)
  clearDragState()
  if (!draggedId || draggedId === targetId) return
  emit('reorder', draggedId, targetId, position)
}

function cardBorderStyle(element: PlanStateElement, index: number, elementsCount: number) {
  const hasChildren = Boolean(element.children?.length)
  const isLast = index === elementsCount - 1

  return {
    width: `${currentItemWidth.value}px`,
    '--plan-card-branch-shadow': branchAccentShadow(activeBranchColor(element)),
    '--plan-card-inner-shadow': branchInnerShadow(activeBranchColor(element)),
    '--plan-card-border-top': 'inset 0 1px 0 var(--plan-card-border-color)',
    '--plan-card-border-right': hasChildren ? '0 0 0 0 transparent' : 'inset -1px 0 0 var(--plan-card-border-color)',
    '--plan-card-border-bottom': isLast ? 'inset 0 -1px 0 var(--plan-card-border-color)' : '0 0 0 0 transparent',
    '--plan-card-border-left': props.isRoot ? '0 0 0 0 transparent' : 'inset 1px 0 0 var(--plan-card-border-color)',
  }
}

onBeforeUnmount(() => {
  resizeCleanup?.()
  clearPointerDragState()
})
</script>

<template>
  <div class="plan-branch">
    <div class="plan-children-column" :style="{ width: `${currentItemWidth}px` }">
      <div
        v-for="(element, index) in visibleElements"
        :key="element.id"
        class="plan-branch-row"
        :class="{
          'plan-branch-row-drop-before': dragOverElementId === element.id && dragOverPosition === 'before',
          'plan-branch-row-drop-after': dragOverElementId === element.id && dragOverPosition === 'after',
        }"
        :data-plan-element-id="element.id"
        :data-plan-column-id="columnId"
        :style="{ height: `${elementLayoutHeight(element)}px` }"
        @dragover="updateDragTarget($event, element.id)"
        @dragleave="dragOverElementId = ''"
        @drop="dropElement($event, element.id)"
      >
        <article
          class="plan-child-card"
          :class="{
            'plan-child-card-dragging': draggingElementId === element.id,
            'plan-child-card-next-step-path': isNextStepPathHighlighted(element),
          }"
          :style="cardBorderStyle(element, index, visibleElements.length)"
          draggable="true"
          @click="selectElement($event, element.id)"
          @pointerdown="startPointerElementDrag($event, element.id)"
          @dragstart="startElementDrag($event, element.id)"
          @dragend="clearDragState"
          @dblclick="startInlineEdit($event, element)"
        >
          <div v-if="isTaskElement(element)" class="plan-child-task">
            <input
              class="plan-child-checkbox"
              type="checkbox"
              :checked="element.completed"
              :aria-label="`Отметить задачу ${element.title}`"
              @change="emit('toggleComplete', element.id, ($event.target as HTMLInputElement).checked)"
              @click.stop
            />
            <input
              v-if="editingElementId === element.id"
              :id="titleInputId(element.id)"
              v-model="titleDraft"
              class="plan-child-title-input"
              type="text"
              aria-label="Название элемента"
              @blur="commitInlineEdit(element)"
              @click.stop
              @dblclick.stop
              @keydown.enter.prevent="commitInlineEdit(element)"
              @keydown.esc.prevent="cancelInlineEdit"
            />
            <span v-else class="plan-child-title">{{ element.title }}</span>
            <span
              v-if="shouldShowNextStepBadge(element)"
              class="plan-next-step-badge"
              draggable="false"
              :aria-label="`${nextStepTaskCount(element)} задач в следующем шаге`"
              @click.stop
              @dblclick.stop
              @dragstart.stop.prevent
              @mouseenter.stop="emit('nextStepBadgeHover', element.id)"
              @mouseleave.stop="emit('nextStepBadgeLeave')"
            >
              {{ nextStepBadgeText(element) }}
            </span>
          </div>
          <span v-else class="plan-child-parent">
            <span
              class="plan-child-progress"
              :aria-label="`Выполнено ${taskProgressPercent(element)} процентов задач`"
            >
              {{ taskProgressPercent(element) }}%
            </span>
            <input
              v-if="editingElementId === element.id"
              :id="titleInputId(element.id)"
              v-model="titleDraft"
              class="plan-child-title-input"
              type="text"
              aria-label="Название элемента"
              @blur="commitInlineEdit(element)"
              @click.stop
              @dblclick.stop
              @keydown.enter.prevent="commitInlineEdit(element)"
              @keydown.esc.prevent="cancelInlineEdit"
            />
            <span v-else class="plan-child-title plan-child-title-parent">{{ element.title }}</span>
            <span
              v-if="shouldShowNextStepBadge(element)"
              class="plan-next-step-badge"
              draggable="false"
              :aria-label="`${nextStepTaskCount(element)} задач в следующем шаге`"
              @click.stop
              @dblclick.stop
              @dragstart.stop.prevent
              @mouseenter.stop="emit('nextStepBadgeHover', element.id)"
              @mouseleave.stop="emit('nextStepBadgeLeave')"
            >
              {{ nextStepBadgeText(element) }}
            </span>
          </span>
          <p v-if="shouldShowCardNote(element)" class="plan-child-note">{{ element.note }}</p>
          <button
            class="plan-child-add-sibling"
            type="button"
            aria-label="Добавить элемент на этом уровне"
            title="Добавить элемент на этом уровне"
            @click.stop="emit('addSibling', element.id)"
          />
          <button
            v-if="isTaskElement(element)"
            class="plan-child-add-child"
            type="button"
            aria-label="Добавить дочерний элемент"
            title="Добавить дочерний элемент"
            @click.stop="emit('addChild', element.id)"
          />
          <span
            class="plan-column-resize-handle"
            aria-hidden="true"
            title="Изменить ширину колонки"
            @click.stop
            @dblclick.stop
            @mousedown.stop.prevent="startColumnResize"
          />
          <button
            v-if="!isTaskElement(element)"
            class="plan-child-expand"
            type="button"
            aria-label="Расширить элемент"
            title="Расширить"
            @click.stop="emit('expand', element.id)"
          >
            <Maximize2 class="plan-child-expand-icon" />
          </button>
          <button
            v-if="isTaskElement(element)"
            class="plan-child-delete"
            type="button"
            aria-label="Удалить элемент"
            title="Удалить"
            @click.stop="emit('delete', element.id)"
          >
            <Trash class="plan-child-delete-icon" />
          </button>
        </article>
        <PlanBranch
          v-if="element.children?.length"
          :elements="element.children"
          :column-depth="props.columnDepth + 1"
          :item-width="props.itemWidth"
          :column-widths="props.columnWidths || {}"
          :branch-color="activeBranchColor(element)"
          :branch-height="elementLayoutHeight(element)"
          :is-root="false"
          :next-step-task-ids="props.nextStepTaskIds || []"
          :highlighted-next-step-task-ids="props.highlightedNextStepTaskIds || []"
          @add-sibling="emit('addSibling', $event)"
          @add-child="emit('addChild', $event)"
          @delete="emit('delete', $event)"
          @expand="emit('expand', $event)"
          @next-step-badge-hover="emit('nextStepBadgeHover', $event)"
          @next-step-badge-leave="emit('nextStepBadgeLeave')"
          @rename="(elementId, title) => emit('rename', elementId, title)"
          @reorder="(draggedId, targetId, position) => emit('reorder', draggedId, targetId, position)"
          @resize-column="(columnId, width) => emit('resizeColumn', columnId, width)"
          @select="emit('select', $event)"
          @toggle-complete="(elementId, completed) => emit('toggleComplete', elementId, completed)"
        />
      </div>
      <button
        v-if="visibleElements.length === 1 && completedTaskElements.length === 0"
        class="plan-add-second-slot"
        type="button"
        aria-label="Добавить второй элемент"
        title="Добавить второй элемент"
        :style="{ width: `${currentItemWidth}px`, height: `${addSlotHeight()}px` }"
        @click="addSecondSlotElement"
      />
      <article
        v-if="completedTaskElements.length"
        class="plan-completed-card"
        :style="{ width: `${currentItemWidth}px`, height: `${completedCardHeight()}px` }"
      >
        <button
          class="plan-completed-card-header"
          type="button"
          :aria-expanded="completedTasksExpanded"
          @click="toggleCompletedTasksExpanded"
        >
          <span class="plan-completed-card-title">Выполненные задачи</span>
          <span class="plan-completed-card-count">{{ completedTaskElements.length }}</span>
        </button>
        <div v-if="completedTasksExpanded" class="plan-completed-card-list">
          <label v-for="task in completedTaskElements" :key="task.id" class="plan-completed-task">
            <input
              class="plan-completed-task-checkbox"
              type="checkbox"
              checked
              :aria-label="`Вернуть задачу ${task.title} в активные`"
              @change="emit('toggleComplete', task.id, false)"
            />
            <span class="plan-completed-task-title">{{ task.title }}</span>
          </label>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.plan-branch {
  height: 100%;
  display: flex;
  align-items: stretch;
}

.plan-children-column {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 0 0 auto;
}

.plan-branch-row {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  position: relative;
}

.plan-add-second-slot {
  flex: 0 0 auto;
  border: 0;
  border-radius: 16px;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.plan-add-second-slot:hover {
  background: #B5A5FF;
}

.plan-child-card {
  --plan-card-border-color: #B9B9B9;
  --plan-card-inner-shadow: 0 0 40px 0 #ABABAB inset;
  --plan-card-next-step-shadow: 0 0 0 0 transparent;
  --plan-card-branch-shadow: 0 0 0 0 transparent;
  --plan-card-border-top: 0 0 0 0 transparent;
  --plan-card-border-right: 0 0 0 0 transparent;
  --plan-card-border-bottom: 0 0 0 0 transparent;
  --plan-card-border-left: 0 0 0 0 transparent;
  height: 100%;
  border-radius: 16px;
  border: 0;
  background: #F5F6FD;
  background: color(display-p3 0.9608 0.9647 0.9882);
  box-shadow:
    var(--plan-card-border-top),
    var(--plan-card-border-right),
    var(--plan-card-border-bottom),
    var(--plan-card-border-left),
    var(--plan-card-branch-shadow),
    var(--plan-card-next-step-shadow),
    var(--plan-card-inner-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  position: relative;
  flex: 0 0 auto;
  cursor: grab;
}

.plan-child-card:active {
  cursor: grabbing;
}

.plan-child-card:hover {
  --plan-card-inner-shadow: 0 0 40px 0 #969696 inset;
}

.plan-child-card-dragging {
  opacity: 0.48;
}

.plan-child-card-next-step-path {
  --plan-card-next-step-shadow: inset 0 0 0 2px rgba(111, 95, 232, 0.72);
}

.plan-branch-row-drop-before > .plan-child-card::before,
.plan-branch-row-drop-after > .plan-child-card::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 3px;
  border-radius: 999px;
  background: #6f5fe8;
  pointer-events: none;
  z-index: 4;
}

.plan-branch-row-drop-before > .plan-child-card::before {
  top: 0;
  transform: translateY(-1px);
}

.plan-branch-row-drop-after > .plan-child-card::after {
  bottom: 0;
  transform: translateY(1px);
}

@supports (color: color(display-p3 1 1 1)) {
  .plan-child-card {
    --plan-card-border-color: color(display-p3 0.7241 0.7241 0.7241);
    --plan-card-inner-shadow: 0 0 40px 0 color(display-p3 0.6725 0.6725 0.6725) inset;
  }

  .plan-child-card:hover {
    --plan-card-inner-shadow: 0 0 40px 0 color(display-p3 0.5882 0.5882 0.5882) inset;
  }
}

.plan-child-task,
.plan-child-parent {
  width: 100%;
  padding: 0 48px 0 16px;
}

.plan-child-task,
.plan-child-parent {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plan-child-task {
  position: absolute;
  top: 16px;
  left: 0;
  right: 0;
  box-sizing: border-box;
  min-width: 0;
}

.plan-child-parent {
  position: absolute;
  top: 16px;
  left: 0;
  right: 0;
  box-sizing: border-box;
  min-width: 0;
}

.plan-child-progress {
  min-width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(86, 96, 113, 0.14);
  color: #566071;
  font-size: 10px;
  font-weight: 800;
  line-height: 22px;
  text-align: center;
  flex: 0 0 auto;
}

.plan-child-note {
  position: absolute;
  left: 16px;
  right: 48px;
  top: 50px;
  margin: 0;
  color: #566071;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.plan-completed-card {
  box-sizing: border-box;
  min-height: 40px;
  border-radius: 16px;
  background: rgba(86, 96, 113, 0.1);
  color: #566071;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  box-shadow: inset 0 1px 0 rgba(86, 96, 113, 0.18);
  flex: 0 0 auto;
  overflow: hidden;
}

.plan-completed-card-header {
  min-height: 40px;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 16px;
  font: inherit;
  cursor: pointer;
}

.plan-completed-card-header:hover {
  background: rgba(86, 96, 113, 0.08);
}

.plan-completed-card-title {
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-completed-card-count {
  min-width: 22px;
  height: 20px;
  border-radius: 999px;
  background: rgba(86, 96, 113, 0.14);
  color: #566071;
  font-size: 10px;
  font-weight: 800;
  line-height: 20px;
  text-align: center;
  flex: 0 0 auto;
}

.plan-completed-card-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 12px;
}

.plan-completed-task {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  color: #3c4658;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.25;
}

.plan-completed-task-checkbox {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  margin: 0;
  accent-color: #566071;
  cursor: pointer;
}

.plan-completed-task-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.plan-next-step-badge {
  min-width: 22px;
  height: 20px;
  border-radius: 999px;
  background: rgba(111, 95, 232, 0.14);
  color: #5d50c8;
  font-size: 11px;
  font-weight: 800;
  line-height: 20px;
  text-align: center;
  flex: 0 0 auto;
  padding: 0 6px;
  cursor: default;
}

.plan-next-step-badge:hover {
  background: rgba(111, 95, 232, 0.2);
}

.plan-child-title {
  min-width: 0;
  color: #242a31;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-child-title-input {
  min-width: 0;
  width: 100%;
  height: 28px;
  border: 1px solid rgba(111, 95, 232, 0.35);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.72);
  color: #242a31;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  outline: none;
  padding: 0 8px;
}

.plan-child-title-input:focus {
  border-color: #6f5fe8;
  box-shadow: 0 0 0 2px rgba(111, 95, 232, 0.16);
}

.plan-child-checkbox {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  accent-color: #6f5fe8;
  cursor: pointer;
}

.plan-child-add-sibling,
.plan-child-add-child {
  position: absolute;
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 0;
  cursor: pointer;
  z-index: 2;
}

.plan-child-add-sibling {
  left: 8px;
  right: 8px;
  bottom: -5px;
  height: 9px;
}

.plan-child-add-child {
  top: 8px;
  right: -10px;
  width: 8px;
  height: calc(100% - 16px);
  background: transparent;
  cursor: pointer;
  z-index: 4;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}

.plan-child-card:hover .plan-child-add-child,
.plan-child-card:focus-within .plan-child-add-child,
.plan-child-add-child:hover,
.plan-child-add-child:focus-visible {
  opacity: 1;
}

.plan-child-add-sibling:hover,
.plan-child-add-child:hover {
  background: #B5A5FF;
}

.plan-child-delete {
  position: absolute;
  right: 4px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #566071;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease, background 120ms ease;
}

.plan-child-card:hover .plan-child-delete,
.plan-child-card:focus-within .plan-child-delete {
  opacity: 1;
  pointer-events: auto;
}

.plan-child-delete:hover {
  background: rgba(255, 255, 255, 0.45);
}

.plan-child-delete-icon {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}

.plan-child-expand {
  position: absolute;
  right: 4px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #566071;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  cursor: pointer;
  transition: opacity 120ms ease, background 120ms ease, color 120ms ease;
}

.plan-child-card:hover .plan-child-expand,
.plan-child-card:focus-within .plan-child-expand {
  opacity: 1;
  pointer-events: auto;
}

.plan-child-expand:hover {
  background: rgba(255, 255, 255, 0.45);
  color: #242a31;
}

.plan-child-expand-icon {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}

.plan-column-resize-handle {
  position: absolute;
  top: 8px;
  right: 0;
  bottom: 8px;
  width: 5px;
  border-radius: 999px;
  background: transparent;
  cursor: ew-resize;
  z-index: 3;
}

.plan-column-resize-handle:hover {
  background: rgba(181, 165, 255, 0.65);
}

</style>
