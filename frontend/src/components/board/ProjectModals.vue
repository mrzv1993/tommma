<script lang="ts">
import { defineComponent } from 'vue'

import { useProjectModalsContext } from '@/app/project-modals-context'

export default defineComponent({
  name: 'ProjectModals',
  setup() {
    return useProjectModalsContext()
  },
})
</script>

<template>
  <div v-if="deleteProjectConfirmOpen" class="modal-backdrop" @click.self="cancelDeleteProjectConfirm">
    <div class="modal-card">
      <h3>Удалить проект?</h3>
      <p>Проект и его задачи в этом сайдбаре будут удалены.</p>
      <div class="modal-actions">
        <button type="button" class="modal-btn" @click="cancelDeleteProjectConfirm">Отмена</button>
        <button type="button" class="modal-btn danger" @click="confirmDeleteProject">Удалить</button>
      </div>
    </div>
  </div>

  <div v-if="deleteSectionConfirmOpen" class="modal-backdrop" @click.self="cancelDeleteSectionConfirm">
    <div class="modal-card">
      <h3>Удалить раздел?</h3>
      <p>Раздел будет удалён вместе со всеми карточками.</p>
      <div class="modal-actions">
        <button type="button" class="modal-btn" @click="cancelDeleteSectionConfirm">Отмена</button>
        <button type="button" class="modal-btn danger" @click="confirmDeleteSection">Удалить</button>
      </div>
    </div>
  </div>

  <div v-if="renameProjectModalOpen" class="modal-backdrop" @click.self="closeRenameProjectModal">
    <div class="modal-card">
      <h3>Переименовать проект</h3>
      <input
        v-model="renameProjectDraft"
        class="modal-input"
        @keydown.enter.prevent="submitRenameProject"
      />
      <div class="modal-actions">
        <button type="button" class="modal-btn" @click="closeRenameProjectModal">Отмена</button>
        <button type="button" class="modal-btn primary" @click="submitRenameProject">Сохранить</button>
      </div>
    </div>
  </div>

  <div v-if="moveProjectModalOpen" class="modal-backdrop" @click.self="closeMoveProjectModal">
    <div class="modal-card move-project-modal">
      <h3>Переместить проект</h3>
      <ul class="move-project-list">
        <li
          v-for="story in moveProjectDraft"
          :key="`move-${story.key}`"
          class="move-project-row"
          :class="{ dragging: draggingProjectKey === story.key }"
          draggable="true"
          @dragstart="handleMoveDragStart(story.key)"
          @dragend="handleMoveDragEnd"
          @dragover="handleMoveDragOver($event, story.key)"
        >
          <span class="move-project-handle">⋮⋮</span>
          <span>{{ story.name }}</span>
        </li>
      </ul>
      <div class="modal-actions">
        <button type="button" class="modal-btn" @click="closeMoveProjectModal">Отмена</button>
        <button type="button" class="modal-btn primary" @click="saveProjectOrder">Сохранить</button>
      </div>
    </div>
  </div>
</template>
