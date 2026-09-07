<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import { useTaskFocus } from '@/app/task-focus-context'
import { FOCUS_BUDGET_MS } from '@/lib/task-focus'
import TaskLifeBadge from './TaskLifeBadge.vue'

const props = withDefaults(defineProps<{ parentTaskId: string; depth?: number; locked?: boolean }>(), { depth: 0, locked: false })
const board = useTaskFocus()
const parent = computed(() => board?.state.value.tasks.find(task => task.id === props.parentTaskId))
const children = computed(() => board?.state.value.tasks
  .filter(task => task.parentTaskId === props.parentTaskId)
  .sort((a, b) => a.createdAt - b.createdAt) ?? [])
const locked = computed(() => props.locked || Boolean(parent.value?.completed))
// Render the form only for a confirmed exhausted task, never on Play.
const formOpen = computed(() => board?.splitTaskId.value === props.parentTaskId && parent.value && !parent.value.completed && !parent.value.isContainer && parent.value.focusSpentMs >= FOCUS_BUDGET_MS)
const drafts = ref<{ id: string; title: string }[]>([])
const busy = ref(false)
const pendingChild = ref<string | null>(null)
const error = ref('')
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
  <div v-if="children.length || formOpen" class="task-subtasks" :style="{ '--child-indent': depth < 5 ? '12px' : '0px' }" @click.stop @dblclick.stop @mousedown.stop @dragstart.stop.prevent>
    <form v-if="formOpen" class="split-form" :aria-label="`Подзадачи: ${parent?.title}`" :aria-busy="busy" @submit.prevent="createChildren">
      <div class="split-heading"><strong>Разбить на подзадачи</strong><button type="button" :disabled="busy" aria-label="Закрыть создание подзадач" @click="board && (board.splitTaskId.value = null)"><X aria-hidden="true" /></button></div>
      <div v-for="(draft, index) in drafts" :key="draft.id" class="split-input-row">
        <input :id="`subtask-${draft.id}`" v-model="draft.title" :aria-label="`Название подзадачи ${index + 1}`" :placeholder="`Подзадача ${index + 1}`" required maxlength="255" :disabled="busy" />
        <button v-if="drafts.length > 2" type="button" :disabled="busy" :aria-label="`Убрать подзадачу ${index + 1}`" @click="drafts.splice(index, 1)"><X aria-hidden="true" /></button>
      </div>
      <p v-if="error" class="split-error" role="alert">{{ error }}</p>
      <div class="split-actions"><button type="button" :disabled="busy || drafts.length >= 50" @click="addDraft">+ Подзадача</button><button type="submit" class="save-subtasks" :disabled="busy || drafts.length < 2 || drafts.some(draft => !draft.title.trim())">{{ busy ? 'Создаю…' : 'Создать подзадачи' }}</button></div>
    </form>
    <ul v-if="children.length" class="subtask-list" :aria-label="`Подзадачи: ${parent?.title}`">
      <li v-for="child in children" :key="child.id" :data-subtask-id="child.id">
        <div class="subtask-row">
          <input type="checkbox" :checked="child.completed" :disabled="locked || Boolean(pendingChild)" :aria-label="`${child.completed ? 'Открыть повторно' : 'Завершить'} подзадачу: ${child.title}`" @change="toggleChild(child.id, $event)" />
          <span class="subtask-title" :class="{ completed: child.completed }">{{ child.title }}</span>
          <TaskLifeBadge :task="child" :disabled="locked || Boolean(pendingChild)" />
          <button v-if="!locked" type="button" class="cancel-subtask" :disabled="Boolean(pendingChild)" :aria-label="`Отменить подзадачу: ${child.title}`" title="Отменить подзадачу" @click="cancelChild(child.id)"><X aria-hidden="true" /></button>
        </div>
        <TaskSubtasks :parent-task-id="child.id" :depth="depth + 1" :locked="locked" />
      </li>
    </ul>
  </div>
</template>
<style scoped>
.task-subtasks { flex:0 0 100%; min-width:0; width:100%; padding:6px 0 0 var(--child-indent); }
.subtask-list { list-style:none; margin:0; padding:0 0 0 8px; border-left:1px solid #dce2eb; }
.subtask-list > li { margin:3px 0; }
.subtask-row { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-height:32px; }
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
</style>
