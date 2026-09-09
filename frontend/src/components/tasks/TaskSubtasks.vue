<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { GripVertical, X } from '@lucide/vue'
import { useTaskFocus } from '@/app/task-focus-context'
import { FOCUS_BUDGET_MS } from '@/lib/task-focus'
import { compareSubtasks, moveSubtaskIds, type SubtaskMove } from '@/lib/task-subtask-order'
import TaskLifeBadge from './TaskLifeBadge.vue'

const props = withDefaults(defineProps<{ parentTaskId: string; depth?: number; locked?: boolean }>(), { depth: 0, locked: false })
const board = useTaskFocus()
const parent = computed(() => board?.state.value.tasks.find(task => task.id === props.parentTaskId))
const savedChildren = computed(() => board?.state.value.tasks
  .filter(task => task.parentTaskId === props.parentTaskId)
  .sort(compareSubtasks) ?? [])
const optimisticOrder = ref<string[] | null>(null)
const children = computed(() => {
  const order = optimisticOrder.value
  if (!order) return savedChildren.value
  const byId = new Map(savedChildren.value.map(child => [child.id, child]))
  return [...order.flatMap(id => byId.get(id) ?? []), ...savedChildren.value.filter(child => !order.includes(child.id))]
})
const locked = computed(() => props.locked || Boolean(parent.value?.completed))
const canAddChild = computed(() => Boolean(parent.value?.isContainer) && !parent.value?.deletedAt && !locked.value)
// Render the form only for a confirmed exhausted task, never on Play.
const formOpen = computed(() => board?.splitTaskId.value === props.parentTaskId && parent.value && !parent.value.completed && !parent.value.isContainer && parent.value.focusSpentMs >= FOCUS_BUDGET_MS)
const drafts = ref<{ id: string; title: string }[]>([])
const busy = ref(false)
const pendingChild = ref<string | null>(null)
const error = ref('')
const childDraft = ref({ id: crypto.randomUUID(), title: '' })
const childInput = ref<HTMLInputElement | null>(null)
const addingChild = ref(false)
const addError = ref('')
const list = ref<HTMLUListElement | null>(null)
const savingOrder = ref(false)
const orderError = ref('')
const orderStatus = ref('')
const dragId = ref('')
const dropTarget = ref<SubtaskMove | null>(null)
const canReorder = computed(() => !locked.value && !savingOrder.value && !addingChild.value && !pendingChild.value && children.value.length > 1)
let pointer: { id: number; childId: string; x: number; y: number; handle: HTMLButtonElement } | null = null

function clearDrag() {
  const previous = pointer
  pointer = null
  dragId.value = ''
  dropTarget.value = null
  if (previous?.handle.hasPointerCapture(previous.id)) previous.handle.releasePointerCapture(previous.id)
}
function startDrag(event: PointerEvent, childId: string) {
  if (!canReorder.value || !event.isPrimary || event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLButtonElement
  handle.focus({ preventScroll: true })
  pointer = { id: event.pointerId, childId, x: event.clientX, y: event.clientY, handle }
  handle.setPointerCapture(event.pointerId)
}
function updateDrag(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.id) return
  if (!canReorder.value) { clearDrag(); return }
  if (!dragId.value && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 5) return
  dragId.value = pointer.childId
  const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.subtask-row')
  const item = row?.parentElement
  // Only the direct sibling list accepts a drop, never another parent or depth.
  if (!row || item?.parentElement !== list.value || item.dataset.subtaskId === pointer.childId) {
    dropTarget.value = null
    return
  }
  const bounds = row.getBoundingClientRect()
  dropTarget.value = { childId: pointer.childId, targetId: item.dataset.subtaskId!, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' }
}
async function saveOrder(move: SubtaskMove) {
  if (!board || !canReorder.value) return
  const before = children.value.map(child => child.id)
  const after = moveSubtaskIds(before, move)
  if (after.every((id, index) => id === before[index])) return
  optimisticOrder.value = after
  savingOrder.value = true
  orderError.value = ''
  orderStatus.value = 'Сохраняю порядок…'
  try {
    await board.reorderSubtasks(props.parentTaskId, move)
    orderStatus.value = 'Порядок подзадач сохранён'
  } catch (e) {
    orderStatus.value = ''
    orderError.value = e instanceof Error ? e.message : 'Не удалось сохранить порядок. Попробуй ещё раз.'
  } finally {
    optimisticOrder.value = null
    savingOrder.value = false
    await nextTick()
    const item = Array.from(list.value?.children ?? []).find(item => (item as HTMLElement).dataset.subtaskId === move.childId)
    item?.querySelector<HTMLButtonElement>('.subtask-drag-handle')?.focus({ preventScroll: true })
  }
}
function finishDrag(event: PointerEvent) {
  if (event.pointerId !== pointer?.id) return
  updateDrag(event)
  const move = dropTarget.value
  clearDrag()
  if (move) void saveOrder(move)
}
function moveByKeyboard(event: KeyboardEvent, childId: string) {
  if (event.key === 'Escape') { clearDrag(); return }
  if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  if (!canReorder.value) return
  const index = children.value.findIndex(child => child.id === childId)
  const offset = event.key === 'ArrowUp' ? -1 : 1
  const target = children.value[index + offset]
  if (target) void saveOrder({ childId, targetId: target.id, position: offset < 0 ? 'before' : 'after' })
}
onBeforeUnmount(clearDrag)
watch(formOpen, open => {
  if (!open) return
  drafts.value = Array.from({ length: 2 }, () => ({ id: crypto.randomUUID(), title: '' }))
  error.value = ''
}, { immediate: true })
function addDraft() { drafts.value.push({ id: crypto.randomUUID(), title: '' }) }
async function createChildren() {
  if (!board || busy.value) return
  busy.value = true
  error.value = ''
  try { await board.splitTask(props.parentTaskId, drafts.value.map(draft => ({ ...draft, title: draft.title.trim() }))) }
  catch (e) { error.value = e instanceof Error ? e.message : 'Не удалось создать подзадачи' }
  finally { busy.value = false }
}
async function addChild() {
  const title = childDraft.value.title.trim()
  if (!board || !canAddChild.value || !title || addingChild.value || pendingChild.value) return
  addingChild.value = true
  addError.value = ''
  try {
    // Keep the same id on failure so a retry cannot create a duplicate.
    await board.splitTask(props.parentTaskId, [{ id: childDraft.value.id, title }])
    childDraft.value = { id: crypto.randomUUID(), title: '' }
  } catch (e) {
    addError.value = e instanceof Error ? e.message : 'Не удалось добавить подзадачу'
  } finally {
    addingChild.value = false
    await nextTick()
    childInput.value?.focus()
  }
}
async function toggleChild(id: string, event: Event) {
  if (!board || pendingChild.value) return
  const input = event.target as HTMLInputElement
  pendingChild.value = id
  try { await board.toggleTask(id) }
  catch (e) { board.focusMessage.value = e instanceof Error ? e.message : 'Не удалось изменить задачу' }
  finally {
    input.checked = board.state.value.tasks.find(task => task.id === id)?.completed ?? false
    pendingChild.value = null
  }
}
async function cancelChild(id: string) {
  if (!board || pendingChild.value) return
  pendingChild.value = id
  try { await board.removeTask(id) }
  catch (e) { board.focusMessage.value = e instanceof Error ? e.message : 'Не удалось отменить подзадачу' }
  finally { pendingChild.value = null }
}
</script>
<template>
  <div v-if="children.length || formOpen || canAddChild" class="task-subtasks" :style="{ '--child-indent': depth < 5 ? '12px' : '0px' }" @click.stop @dblclick.stop @mousedown.stop @pointerdown.stop @dragstart.stop.prevent>
    <form v-if="formOpen" class="split-form" :aria-label="`Подзадачи: ${parent?.title}`" :aria-busy="busy" @submit.prevent="createChildren">
      <div class="split-heading"><strong>Разбить на подзадачи</strong><button type="button" :disabled="busy" aria-label="Закрыть создание подзадач" @click="board && (board.splitTaskId.value = null)"><X aria-hidden="true" /></button></div>
      <div v-for="(draft, index) in drafts" :key="draft.id" class="split-input-row">
        <input :id="`subtask-${draft.id}`" v-model="draft.title" :aria-label="`Название подзадачи ${index + 1}`" :placeholder="`Подзадача ${index + 1}`" required maxlength="255" :disabled="busy" />
        <button v-if="drafts.length > 2" type="button" :disabled="busy" :aria-label="`Убрать подзадачу ${index + 1}`" @click="drafts.splice(index, 1)"><X aria-hidden="true" /></button>
      </div>
      <p v-if="error" class="split-error" role="alert">{{ error }}</p>
      <div class="split-actions"><button type="button" :disabled="busy || drafts.length >= 50" @click="addDraft">+ Подзадача</button><button type="submit" class="save-subtasks" :disabled="busy || drafts.length < 2 || drafts.some(draft => !draft.title.trim())">{{ busy ? 'Создаю…' : 'Создать подзадачи' }}</button></div>
    </form>
    <ul v-if="children.length" ref="list" class="subtask-list" :aria-label="`Подзадачи: ${parent?.title}`" :aria-busy="savingOrder">
      <li v-for="child in children" :key="child.id" :data-subtask-id="child.id" :class="{ 'subtask-dragging': dragId === child.id, 'subtask-drop-before': dropTarget?.targetId === child.id && dropTarget.position === 'before', 'subtask-drop-after': dropTarget?.targetId === child.id && dropTarget.position === 'after' }">
        <div class="subtask-row">
          <button type="button" class="subtask-drag-handle" :disabled="!canReorder" :aria-label="`Переместить подзадачу: ${child.title}`" title="Перетащи для изменения порядка или используй стрелки ↑ ↓" aria-keyshortcuts="ArrowUp ArrowDown" @pointerdown.stop="startDrag($event, child.id)" @pointermove="updateDrag" @pointerup="finishDrag" @pointercancel="clearDrag" @lostpointercapture="clearDrag" @keydown.stop="moveByKeyboard($event, child.id)"><GripVertical aria-hidden="true" /></button>
          <input type="checkbox" :checked="child.completed" :disabled="locked || addingChild || savingOrder || Boolean(pendingChild)" :aria-label="`${child.completed ? 'Открыть повторно' : 'Завершить'} подзадачу: ${child.title}`" @change="toggleChild(child.id, $event)" />
          <span class="subtask-title" :class="{ completed: child.completed }">{{ child.title }}</span>
          <TaskLifeBadge :task="child" :disabled="locked || addingChild || Boolean(pendingChild)" />
          <button v-if="!locked" type="button" class="cancel-subtask" :disabled="addingChild || savingOrder || Boolean(pendingChild)" :aria-label="`Отменить подзадачу: ${child.title}`" title="Отменить подзадачу" @click="cancelChild(child.id)"><X aria-hidden="true" /></button>
        </div>
        <TaskSubtasks :parent-task-id="child.id" :depth="depth + 1" :locked="locked" />
      </li>
    </ul>
    <p v-if="orderError" class="split-error" role="alert">{{ orderError }}</p>
    <span class="sr-only" role="status" aria-live="polite">{{ orderStatus }}</span>
    <form v-if="canAddChild" class="add-child-form" :aria-label="`Добавление подзадачи: ${parent?.title}`" :aria-busy="addingChild" @submit.prevent="addChild">
      <div class="add-child-row">
        <input ref="childInput" v-model="childDraft.title" type="text" :aria-label="`Название новой подзадачи: ${parent?.title}`" :aria-describedby="addError ? `add-subtask-error-${parentTaskId}` : undefined" placeholder="Новая подзадача…" autocomplete="off" required maxlength="255" :disabled="addingChild || Boolean(pendingChild)" />
        <button type="submit" :aria-label="`Добавить подзадачу: ${parent?.title}`" :disabled="addingChild || Boolean(pendingChild) || !childDraft.title.trim()">{{ addingChild ? 'Добавляю…' : 'Добавить' }}</button>
      </div>
      <p v-if="addError" :id="`add-subtask-error-${parentTaskId}`" class="split-error" role="alert">{{ addError }}</p>
    </form>
  </div>
</template>
<style scoped>
.task-subtasks { flex:0 0 100%; min-width:0; width:100%; padding:6px 0 0 var(--child-indent); }
.subtask-list { list-style:none; margin:0; padding:0; }
.subtask-list > li { margin:3px 0; }
.subtask-row { position:relative; display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-height:32px; border-radius:5px; }
.subtask-dragging > .subtask-row { opacity:.5; background:#e1e8f4; }
.subtask-drop-before > .subtask-row::before,.subtask-drop-after > .subtask-row::after { content:''; position:absolute; left:0; right:0; height:2px; border-radius:2px; background:#5369bc; pointer-events:none; }
.subtask-drop-before > .subtask-row::before { top:-2px; }
.subtask-drop-after > .subtask-row::after { bottom:-2px; }
.subtask-drag-handle { display:inline-flex; align-items:center; justify-content:center; flex:0 0 22px; width:22px; height:28px; padding:3px; border:0; border-radius:5px; background:transparent; color:#778296; cursor:grab; touch-action:none; user-select:none; }
.subtask-drag-handle:hover:not(:disabled) { color:#354971; background:#e1e8f4; }
.subtask-drag-handle:active:not(:disabled) { cursor:grabbing; }
.subtask-row > input { width:15px; height:15px; flex:0 0 auto; cursor:pointer; accent-color:#354971; }
.subtask-title { flex:1 1 80px; min-width:0; font-size:13px; color:#334155; overflow-wrap:anywhere; }
.subtask-title.completed { color:#7b8493; text-decoration:line-through; }
.cancel-subtask,.split-heading button,.split-input-row button { display:inline-flex; align-items:center; justify-content:center; width:24px; height:26px; padding:3px; border:0; border-radius:5px; color:#778296; background:transparent; cursor:pointer; }
button svg { width:14px; height:14px; }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible,input:focus-visible { outline:2px solid #5369bc; outline-offset:2px; }
.split-form { max-width:540px; margin:4px 0 8px; padding:12px; border:1px solid #dce2eb; border-radius:8px; background:white; font-size:13px; }
.split-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; color:#334155; }
.split-heading strong { font-weight:600; }
.split-input-row { display:flex; align-items:center; gap:4px; margin:6px 0; }
.split-input-row input { width:100%; min-width:0; padding:7px 9px; border:1px solid #cbd3df; border-radius:6px; font:inherit; }
.split-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.split-actions button { cursor:pointer; padding:7px 10px; border:1px solid #dce2eb; border-radius:6px; color:#526382; background:#f7f8fa; font:inherit; }
.split-actions .save-subtasks { background:#354971; color:white; border-color:#354971; }
.split-error { color:#943344; margin:6px 0; }
.add-child-form { padding:4px 0 3px 28px; font-size:13px; }
.add-child-row { display:flex; align-items:center; gap:6px; }
.add-child-row input { flex:1; min-width:0; height:30px; padding:5px 8px; border:1px solid #dce2eb; border-radius:6px; background:white; color:#334155; font:inherit; }
.add-child-row input::placeholder { color:#778296; }
.add-child-row button { flex:0 0 auto; height:30px; padding:5px 9px; border:1px solid #dce2eb; border-radius:6px; background:#f7f8fa; color:#526382; font:inherit; cursor:pointer; }
.add-child-row button:hover:not(:disabled) { background:#e8edf6; }
@media (max-width:600px) {
  .subtask-row { display:grid; grid-template-columns:22px 15px minmax(0,1fr) 24px; padding:3px 0; }
  .subtask-drag-handle { grid-column:1; grid-row:1; }
  .subtask-row > input { grid-column:2; grid-row:1; }
  .subtask-title { grid-column:3; grid-row:1; }
  .cancel-subtask { grid-column:4; grid-row:1; }
  .subtask-row > :deep(.task-lives) { grid-column:2 / -1; grid-row:2; justify-self:end; }
}
</style>
