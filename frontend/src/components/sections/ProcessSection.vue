<script setup lang="ts">
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, GripVertical, Inbox, RotateCcw, Trash2 } from '@lucide/vue'
import { nextTick, onActivated, ref, watch } from 'vue'
import { useProcessState } from '@/app/process-state'
import type { ProcessAction, ProcessItem } from '@/lib/process-items'
import type { PriorityMode } from '@/lib/priority-mode'
import PriorityModeSwitch from './PriorityModeSwitch.vue'
import PriorityTaskTitleDisplay from './PriorityTaskTitleDisplay.vue'

const emit = defineEmits<{ changeMode: [mode: PriorityMode] }>()
const { inbox, trash, loaded, loading, busy, error, load, add, mutate } = useProcessState()
const view = ref<'inbox' | 'trash'>('inbox')
const draft = ref('')
const editingId = ref('')
const editTitle = ref('')
const baseTitle = ref('')
const editInput = ref<HTMLInputElement[]>([])
const editorError = ref('')
const draggedId = ref('')
const dropId = ref('')
const dropAfter = ref(false)

onActivated(load)
watch(inbox, items => {
  if (editingId.value && !items.some(item => item.id === editingId.value)) cancelEdit()
})

async function submit() {
  const title = draft.value.trim()
  if (!title || busy.value) return
  try { await add(title); draft.value = '' } catch { /* Keep the draft for retry. */ }
}

async function startEditing(item: ProcessItem) {
  if (busy.value) return
  editingId.value = item.id
  editTitle.value = baseTitle.value = item.title
  editorError.value = ''
  await nextTick()
  const input = editInput.value[0]
  input?.focus()
  input?.setSelectionRange(input.value.length, input.value.length)
}

function cancelEdit() { editingId.value = ''; editorError.value = '' }

async function saveEdit(item: ProcessItem) {
  if (editingId.value !== item.id || busy.value) return
  const title = editTitle.value.trim()
  if (!title) { editorError.value = 'Укажи название записи'; return }
  if (title === baseTitle.value) { cancelEdit(); return }
  editorError.value = ''
  try {
    await mutate({ type: 'edit', id: item.id, title, baseTitle: baseTitle.value })
    cancelEdit()
  } catch { /* Keep the editor and original base title if saving fails. */ }
}

async function act(action: ProcessAction) {
  if (busy.value) return
  try { await mutate(action) } catch { /* Error and retry remain visible. */ }
}

function startDrag(event: DragEvent, id: string) {
  if (busy.value || editingId.value) { event.preventDefault(); return }
  draggedId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-tommma-process-item', id)
  }
}

function dragOver(event: DragEvent, id: string) {
  if (!draggedId.value || draggedId.value === id || busy.value) return
  event.preventDefault()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropId.value = id
  dropAfter.value = event.clientY >= bounds.top + bounds.height / 2
}

function resetDrag() { draggedId.value = ''; dropId.value = '' }

function drop(event: DragEvent, target: number) {
  event.preventDefault()
  const source = inbox.value.findIndex(item => item.id === draggedId.value)
  if (source < 0 || !dropId.value || busy.value) { resetDrag(); return }
  const insertion = target + Number(dropAfter.value)
  const targetIndex = insertion - Number(source < insertion)
  const id = draggedId.value
  resetDrag()
  if (source !== targetIndex) void act({ type: 'move', id, targetIndex })
}

function moveBy(index: number, delta: number) {
  const item = inbox.value[index]
  const targetIndex = index + delta
  if (item && !editingId.value && targetIndex >= 0 && targetIndex < inbox.value.length) void act({ type: 'move', id: item.id, targetIndex })
}
</script>

<template>
  <section class="process-screen" aria-label="Приоритеты: Процесс">
    <div class="process-shell">
    <header class="process-header">
      <h1>Приоритеты</h1>
      <PriorityModeSwitch model-value="process" @update:model-value="emit('changeMode', $event)" />
    </header>

    <div v-if="error" class="process-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" :disabled="loading || busy" @click="load">Обновить список</button>
    </div>
    <p v-if="loading && !loaded" class="process-status" role="status">Загружаем записи…</p>

    <template v-if="loaded">
      <button v-if="view === 'trash'" class="process-back" type="button" @click="view = 'inbox'">
        <ChevronLeft aria-hidden="true" />Назад во «Входящие»
      </button>
      <article class="process-card" :aria-busy="busy">
        <header class="process-card-header">
          <span class="process-icon"><Inbox v-if="view === 'inbox'" aria-hidden="true" /><Trash2 v-else aria-hidden="true" /></span>
          <div class="process-heading">
            <h2>{{ view === 'inbox' ? 'Входящие' : 'Корзина' }}</h2>
            <p>{{ view === 'inbox' ? 'Все записи процесса' : 'Удалённые записи можно восстановить' }}</p>
          </div>
          <span class="process-count" :aria-label="`Записей: ${view === 'inbox' ? inbox.length : trash.length}`">{{ view === 'inbox' ? inbox.length : trash.length }}</span>
        </header>

        <template v-if="view === 'inbox'">
          <form class="process-add" @submit.prevent="submit">
            <input v-model="draft" type="text" maxlength="255" autocomplete="off" aria-label="Добавить запись во Входящие" placeholder="Добавить запись во Входящие…" :disabled="busy" />
            <button type="submit" :disabled="!draft.trim() || busy">Добавить</button>
          </form>
          <div class="process-list" aria-label="Входящие процесса">
            <div v-for="(item, index) in inbox" :key="item.id" class="process-row" :data-process-id="item.id"
              :class="{ dragging: draggedId === item.id, 'drop-before': dropId === item.id && !dropAfter, 'drop-after': dropId === item.id && dropAfter }"
              :draggable="!busy && !editingId" @dragstart="startDrag($event, item.id)" @dragend="resetDrag" @dragover="dragOver($event, item.id)" @drop="drop($event, index)"
              @keydown.alt.up.prevent="moveBy(index, -1)" @keydown.alt.down.prevent="moveBy(index, 1)">
              <GripVertical class="process-grip" aria-hidden="true" />
              <form v-if="editingId === item.id" class="process-edit" @submit.prevent="saveEdit(item)" @dragstart.stop.prevent>
                <input ref="editInput" v-model="editTitle" type="text" maxlength="255" autocomplete="off" :aria-label="`Название записи: ${baseTitle}`" :disabled="busy"
                  :aria-invalid="!!editorError" :aria-describedby="editorError ? 'process-editor-error' : undefined" @blur="saveEdit(item)" @keydown.esc.prevent="cancelEdit" />
                <span v-if="editorError" id="process-editor-error" role="alert">{{ editorError }}</span>
              </form>
              <button v-else class="process-title" type="button" draggable="false" :disabled="busy" :aria-label="`Редактировать запись: ${item.title}`" @click="startEditing(item)" @dragstart.stop.prevent>
                <PriorityTaskTitleDisplay :title="item.title" />
              </button>
              <div class="process-row-actions" @dragstart.stop.prevent>
                <button type="button" class="process-action move-action" :aria-label="`Поднять запись: ${item.title}`" title="Поднять · Alt+↑" :disabled="busy || !!editingId || index === 0" @click="moveBy(index, -1)"><ArrowUp aria-hidden="true" /></button>
                <button type="button" class="process-action move-action" :aria-label="`Опустить запись: ${item.title}`" title="Опустить · Alt+↓" :disabled="busy || !!editingId || index === inbox.length - 1" @click="moveBy(index, 1)"><ArrowDown aria-hidden="true" /></button>
                <button type="button" class="process-action" :aria-label="`Удалить запись: ${item.title}`" title="В корзину" :disabled="busy" @click="act({ type: 'delete', id: item.id })"><Trash2 aria-hidden="true" /></button>
              </div>
            </div>
          </div>
          <p v-if="!inbox.length" class="process-empty">Здесь появятся новые и восстановленные записи</p>
        </template>

        <div v-else class="process-list" aria-label="Корзина процесса">
          <div v-for="item in trash" :key="item.id" class="process-row">
            <span class="process-trash-title"><PriorityTaskTitleDisplay :title="item.title" /></span>
            <button type="button" class="process-action" :disabled="busy" :aria-label="`Восстановить запись: ${item.title}`" title="Вернуть во Входящие" @click="act({ type: 'restore', id: item.id })"><RotateCcw aria-hidden="true" /></button>
          </div>
          <p v-if="!trash.length" class="process-empty">Корзина пуста</p>
        </div>
      </article>
      <button v-if="view === 'inbox'" class="process-trash-link" type="button" :disabled="busy" @click="view = 'trash'; cancelEdit()">
        <Trash2 aria-hidden="true" /><span>Корзина</span><span class="process-count">{{ trash.length }}</span><ChevronRight aria-hidden="true" />
      </button>
      <p class="process-save-status" role="status">{{ busy ? 'Сохраняем…' : '' }}</p>
    </template>
    </div>
  </section>
</template>

<style scoped>
.process-screen { flex: 1; min-width: 0; min-height: 100vh; margin-left: 72px; background: #f3f4f6; padding: 28px 28px 80px; }
.process-shell { width: min(1180px, 100%); margin: 0 auto; }
.process-header { display: flex; align-items: center; flex-wrap: wrap; gap: 20px; margin-bottom: 20px; }
h1 { margin: 0; color: #242a31; font-size: 28px; line-height: 1.15; font-weight: 780; letter-spacing: -.02em; }
button, input { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible, input:focus-visible { outline: 2px solid #8fb1ff; outline-offset: 2px; }
.process-card { border: 1px solid #e0e5ed; border-radius: 12px; background: #fff; padding: 10px; }
.process-card-header { display: flex; align-items: center; gap: 10px; min-height: 36px; }
.process-icon { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 32px; height: 32px; border-radius: 9px; background: #d6e4fb; color: #1f3b67; }
.process-icon svg { width: 17px; height: 17px; }
.process-heading { flex: 1; min-width: 0; }
.process-heading h2 { margin: 0; font-size: 14px; line-height: 1.3; color: #303844; }
.process-heading p { margin: 2px 0 0; color: #8994a6; font-size: 11px; }
.process-count { min-width: 30px; border-radius: 999px; background: #f0f2f6; color: #667287; padding: 4px 8px; text-align: center; font-size: 11px; font-weight: 750; }
.process-add { display: flex; gap: 8px; margin: 10px 0; }
.process-add input, .process-edit input { min-width: 0; width: 100%; flex: 1; border: 1px solid #cfd7e3; border-radius: 7px; background: #fff; color: #303844; padding: 6px 9px; }
.process-add button { border: 0; border-radius: 8px; background: #1f3b67; color: #fff; padding: 0 12px; font-size: 12px; font-weight: 700; }
.process-list { display: flex; flex-direction: column; gap: 3px; margin-top: 7px; }
.process-row { position: relative; display: flex; align-items: center; min-height: 36px; gap: 6px; padding: 5px 7px; border-radius: 8px; background: #f4f6f9; font-size: 13px; }
.process-row[draggable=true] { cursor: grab; }
.process-row:hover, .process-row:focus-within { background: #ebeff5; }
.process-row.dragging { opacity: .45; }
.process-row.drop-before::before, .process-row.drop-after::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: #2455be; }
.process-row.drop-before::before { top: -2px; }.process-row.drop-after::after { bottom: -2px; }
.process-grip { width: 14px; height: 16px; flex-shrink: 0; color: #8994a6; }
.process-title { flex: 1; min-width: 0; border: 0; padding: 2px 0; text-align: left; color: #303844; background: transparent; overflow-wrap: anywhere; }
.process-edit { flex: 1; min-width: 0; }.process-edit span { display: block; color: #b42318; font-size: 11px; margin-top: 4px; }
.process-row-actions { display: flex; align-items: center; flex-shrink: 0; gap: 2px; }
.process-action { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 5px; background: transparent; color: #7b889b; flex-shrink: 0; }
.process-action svg { width: 15px; height: 15px; }
.process-action:hover:not(:disabled) { background: #dfe7f3; color: #1f3b67; }
.move-action { opacity: 0; }.process-row:hover .move-action, .process-row:focus-within .move-action { opacity: 1; }.process-row:hover .move-action:disabled, .process-row:focus-within .move-action:disabled { opacity: .3; }
.process-empty { margin: 8px 0 0; padding: 18px 10px; border: 1px dashed #d4dce8; border-radius: 7px; text-align: center; color: #8994a6; font-size: 12px; }
.process-trash-link { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px; margin-top: 10px; border: 1px solid #e0e5ed; border-radius: 12px; background: #fff; color: #687489; font-size: 13px; text-align: left; }
.process-trash-link > span:first-of-type { flex: 1; }.process-trash-link svg { width: 17px; height: 17px; }
.process-trash-title { flex: 1; min-width: 0; overflow-wrap: anywhere; color: #687489; }
.process-back { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 5px 0; margin-bottom: 10px; background: transparent; color: #687489; font-size: 12px; }.process-back svg { width: 16px; height: 16px; }
.process-error { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 12px; margin-bottom: 12px; border: 1px solid #f0d0ce; border-radius: 8px; background: #fff5f4; color: #9a3027; font-size: 13px; }
.process-error button { border: 1px solid #e6b7b4; border-radius: 6px; background: #fff; color: inherit; padding: 5px 10px; font-size: 12px; }
.process-status, .process-save-status { color: #8994a6; font-size: 12px; }.process-save-status { min-height: 18px; margin: 8px 0 0; }
@media (hover: none) { .move-action { opacity: 1; }.move-action:disabled { opacity: .3; }.process-action { width: 32px; height: 34px; } }
@media (max-width: 760px) { .process-screen { margin-left: 0; padding: 72px 14px 56px; } }
@media (max-width: 480px) { .process-header { gap: 12px; }h1 { font-size: 24px; }.process-card { padding: 8px; }.process-row { gap: 3px; padding: 4px; }.process-grip { width: 10px; }.process-title, .process-trash-title { font-size: 13px; } }
</style>
