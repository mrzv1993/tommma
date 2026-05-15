<script setup lang="ts">
import { Grip, SquarePen, Trash2 } from '@lucide/vue'

import { useProjectSidebarContext } from '@/app/project-sidebar-context'
import ProjectAddGrid from '@/components/board/ProjectAddGrid.vue'
import ProjectCardRow from '@/components/board/ProjectCardRow.vue'
import ProjectSection from '@/components/board/ProjectSection.vue'
import ProjectStoriesList from '@/components/board/ProjectStoriesList.vue'

const app = useProjectSidebarContext()
</script>

<template>
  <aside class="project-sidebar" :style="app.projectSidebarInlineStyle">
    <ProjectStoriesList />

    <div class="project-sections">
      <h3 v-if="app.selectedProjectStory" class="project-selected-title">
        <span class="project-selected-title-text">{{ app.selectedProjectStory.name }}</span>
        <span class="project-selected-progress-badge">{{ app.selectedProjectProgressPercent }}%</span>
      </h3>

      <ul
        v-if="app.selectedProjectRootCards.length || app.draggingCardId"
        class="project-card-list"
        :class="{ 'project-card-list-drop-target': app.isCardDropContainerTarget(app.selectedProjectRootSectionId) }"
        @dragover="app.handleCardDragOver($event, app.selectedProjectRootSectionId, null)"
        @dragleave="app.handleCardListDragLeave($event, app.selectedProjectRootSectionId)"
        @drop="app.handleCardDrop($event, app.selectedProjectRootSectionId, null)"
      >
        <ProjectCardRow
          v-for="card in app.selectedProjectRootCards"
          :key="card.id"
          :card="card"
          :section-id="app.selectedProjectRootSectionId"
        />
      </ul>

      <ProjectAddGrid
        v-if="app.selectedProjectHasNoSections"
        :section-id="app.selectedProjectRootSectionId"
        root
        stacked
      />
      <ProjectAddGrid
        v-else-if="app.selectedProjectKey"
        :section-id="app.selectedProjectRootSectionId"
        root
      />

      <ProjectSection v-for="section in app.selectedProjectSections" :key="section.id" :section="section" />
    </div>

    <div class="project-actions">
      <button
        class="project-action-btn"
        type="button"
        aria-label="Переименовать проект"
        title="Переименовать проект"
        @click="app.openRenameProjectModal"
      >
        <SquarePen :size="16" />
      </button>
      <button
        class="project-action-btn"
        type="button"
        aria-label="Переместить проект"
        title="Переместить проект"
        @click="app.openMoveProjectModal"
      >
        <Grip :size="16" />
      </button>
      <button
        class="project-action-btn danger"
        type="button"
        aria-label="Удалить проект"
        title="Удалить проект"
        @click="app.openDeleteProjectConfirm"
      >
        <Trash2 :size="16" />
      </button>
    </div>
    <div class="project-sidebar-resize-handle" @mousedown="app.startSidebarResize" />
  </aside>
</template>
