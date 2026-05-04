<script setup lang="ts">
import { computed, ref } from 'vue'

type NoteItem = {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'tommma.notes.v1'

function loadNotes(): NoteItem[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const item = entry as Partial<NoteItem>
        if (typeof item.id !== 'string' || typeof item.text !== 'string') return null
        return {
          id: item.id,
          text: item.text,
          createdAt: Number(item.createdAt || Date.now()),
          updatedAt: Number(item.updatedAt || Date.now()),
        } satisfies NoteItem
      })
      .filter((item): item is NoteItem => item !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

const notes = ref<NoteItem[]>(loadNotes())
const query = ref('')
const draft = ref('')
const editingId = ref('')
const editingDraft = ref('')

function persistNotes() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes.value))
}

const visibleNotes = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return notes.value
  return notes.value.filter((note) => note.text.toLowerCase().includes(q))
})

function createNote() {
  const text = draft.value.trim()
  if (!text) return
  const now = Date.now()
  notes.value.unshift({
    id: crypto.randomUUID(),
    text,
    createdAt: now,
    updatedAt: now,
  })
  draft.value = ''
  persistNotes()
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
  cancelEdit()
}

function removeNote(noteId: string) {
  notes.value = notes.value.filter((item) => item.id !== noteId)
  persistNotes()
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section class="notes-board">
    <header class="notes-toolbar">
      <h2>Заметки</h2>
      <input v-model="query" class="notes-search" placeholder="Поиск" />
    </header>

    <div class="notes-create">
      <textarea
        v-model="draft"
        class="notes-input"
        rows="3"
        placeholder="Напишите заметку..."
        @keydown.meta.enter.prevent="createNote"
        @keydown.ctrl.enter.prevent="createNote"
      />
      <button type="button" class="notes-btn" @click="createNote">Добавить</button>
    </div>

    <ul class="notes-list">
      <li v-for="note in visibleNotes" :key="note.id" class="note-card">
        <div class="note-meta">{{ formatDate(note.updatedAt) }}</div>
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
        <p v-else class="note-text" @dblclick="startEdit(note)">{{ note.text }}</p>
        <div class="note-actions">
          <button v-if="editingId !== note.id" type="button" class="note-action" @click="startEdit(note)">Изм.</button>
          <button v-if="editingId === note.id" type="button" class="note-action" @click="saveEdit">Сохранить</button>
          <button v-if="editingId === note.id" type="button" class="note-action" @click="cancelEdit">Отмена</button>
          <button type="button" class="note-action danger" @click="removeNote(note.id)">Удалить</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.notes-board {
  min-height: calc(100vh - 32px);
  border-radius: 12px;
  background: #eff1f5;
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

.notes-create {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-card {
  background: #ffffff;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.note-meta {
  color: #7e8ca0;
  font-size: 12px;
}

.note-text {
  margin: 0;
  white-space: pre-wrap;
  color: #263445;
}

.note-actions {
  display: flex;
  gap: 6px;
}

.note-action.danger {
  background: #f8d8e4;
  color: #b63e67;
}
</style>
