<script setup lang="ts">
import { CircleX, Maximize2 } from '@lucide/vue'
import { computed, nextTick, ref } from 'vue'

import type { PlanStateElement } from '@/lib/api'

const PLAN_ELEMENT_MIN_HEIGHT = 40
const PLAN_PARENT_ELEMENT_MIN_HEIGHT = 80
const PLAN_DRAG_DATA_TYPE = 'application/x-tommma-plan-element-id'
type DragPosition = 'before' | 'after'

const props = defineProps<{
  elements: PlanStateElement[]
  itemWidth: number
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
  toggleComplete: [elementId: string, completed: boolean]
}>()

const draggingElementId = ref('')
const dragOverElementId = ref('')
const dragOverPosition = ref<DragPosition>('before')
const editingElementId = ref('')
const titleDraft = ref('')
let selectClickTimeout: number | null = null

const nextStepTaskIdSet = computed(() => new Set(props.nextStepTaskIds || []))
const highlightedNextStepTaskIdSet = computed(() => new Set(props.highlightedNextStepTaskIds || []))

function isTaskElement(element: PlanStateElement) {
  return !element.children?.length
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
  const requiredTotal = requiredBranchHeight(props.elements)
  const slots = props.elements.length === 1 ? 2 : props.elements.length
  const extra = Math.max(0, props.branchHeight - requiredTotal)
  const distributedExtra = props.elements.length ? extra / slots : 0
  return requiredElementHeight(element) + distributedExtra
}

function addSlotHeight() {
  const firstElement = props.elements[0]
  return firstElement ? elementLayoutHeight(firstElement) : 0
}

function addSecondSlotElement() {
  const firstElement = props.elements[0]
  if (!firstElement) return
  emit('addSibling', firstElement.id)
}

function titleInputId(elementId: string) {
  return `plan-title-editor-${elementId}`
}

function isDragControl(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('button, input'))
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

function getDraggedElementId(event: DragEvent) {
  return event.dataTransfer?.getData(PLAN_DRAG_DATA_TYPE) || event.dataTransfer?.getData('text/plain') || ''
}

function clearDragState() {
  draggingElementId.value = ''
  dragOverElementId.value = ''
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

function cardBorderStyle(element: PlanStateElement, index: number) {
  const hasChildren = Boolean(element.children?.length)
  const isLast = index === props.elements.length - 1

  return {
    width: `${props.itemWidth}px`,
    '--plan-card-border-top': 'inset 0 1px 0 var(--plan-card-border-color)',
    '--plan-card-border-right': hasChildren ? '0 0 0 0 transparent' : 'inset -1px 0 0 var(--plan-card-border-color)',
    '--plan-card-border-bottom': isLast ? 'inset 0 -1px 0 var(--plan-card-border-color)' : '0 0 0 0 transparent',
    '--plan-card-border-left': props.isRoot ? '0 0 0 0 transparent' : 'inset 1px 0 0 var(--plan-card-border-color)',
  }
}
</script>

<template>
  <div class="plan-branch">
    <div class="plan-children-column" :style="{ width: `${props.itemWidth}px` }">
      <div
        v-for="(element, index) in elements"
        :key="element.id"
        class="plan-branch-row"
        :class="{
          'plan-branch-row-drop-before': dragOverElementId === element.id && dragOverPosition === 'before',
          'plan-branch-row-drop-after': dragOverElementId === element.id && dragOverPosition === 'after',
        }"
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
          :style="cardBorderStyle(element, index)"
          draggable="true"
          @click="selectElement($event, element.id)"
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
          <button
            class="plan-child-add-sibling"
            type="button"
            aria-label="Добавить элемент на этом уровне"
            title="Добавить элемент на этом уровне"
            @click.stop="emit('addSibling', element.id)"
          />
          <button
            class="plan-child-add-child"
            type="button"
            aria-label="Добавить дочерний элемент"
            title="Добавить дочерний элемент"
            @click.stop="emit('addChild', element.id)"
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
            <CircleX class="plan-child-delete-icon" />
          </button>
        </article>
        <PlanBranch
          v-if="element.children?.length"
          :elements="element.children"
          :item-width="props.itemWidth"
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
          @select="emit('select', $event)"
          @toggle-complete="(elementId, completed) => emit('toggleComplete', elementId, completed)"
        />
      </div>
      <button
        v-if="elements.length === 1"
        class="plan-add-second-slot"
        type="button"
        aria-label="Добавить второй элемент"
        title="Добавить второй элемент"
        :style="{ width: `${props.itemWidth}px`, height: `${addSlotHeight()}px` }"
        @click="addSecondSlotElement"
      />
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
  overflow-wrap: anywhere;
  white-space: normal;
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
  right: -5px;
  width: 9px;
  height: calc(100% - 16px);
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
  color: #8a4b5f;
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
</style>
