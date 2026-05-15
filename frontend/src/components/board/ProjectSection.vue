<script setup lang="ts">
import ProjectAddGrid from '@/components/board/ProjectAddGrid.vue'
import ProjectCardRow from '@/components/board/ProjectCardRow.vue'
import { useProjectSidebarContext } from '@/app/project-sidebar-context'
import type { SectionItem } from '@/app/project-model'

defineProps<{
  section: SectionItem
}>()

const app = useProjectSidebarContext()
</script>

<template>
  <article class="project-section">
    <header class="project-section-head">
      <input
        v-if="app.editingSectionId === section.id"
        v-model="app.editingSectionDraft"
        class="project-section-title-input"
        @keydown.enter.prevent="app.submitSectionRename"
        @keydown.esc.prevent="app.editingSectionId = ''"
        @blur="app.submitSectionRename"
      />
      <h4 v-else class="project-section-title" @dblclick.stop="app.startSectionRenameByDoubleClick(section)">
        {{ section.title }}
      </h4>
      <div
        class="project-item-menu-wrap"
        tabindex="-1"
        @focusout="app.closeMenuOnBlur('section', section.id, $event)"
        @keydown.esc.prevent="app.sectionMenuOpenId = ''"
      >
        <button class="project-item-menu-btn" type="button" @click="app.toggleSectionMenu(section.id, $event)">⋯</button>
        <div v-if="app.sectionMenuOpenId === section.id" class="project-item-menu">
          <button type="button" @click="app.startSectionRename(section)">Редактировать раздел</button>
          <button type="button" class="danger" @click="app.openDeleteSectionConfirm(section.id)">Удалить раздел</button>
        </div>
      </div>
    </header>

    <ul
      class="project-card-list"
      :class="{ 'project-card-list-drop-target': app.isCardDropContainerTarget(section.id) }"
      @dragover="app.handleCardDragOver($event, section.id, null)"
      @dragleave="app.handleCardListDragLeave($event, section.id)"
      @drop="app.handleCardDrop($event, section.id, null)"
    >
      <ProjectCardRow
        v-for="card in app.cardsForSection(section.id)"
        :key="card.id"
        :card="card"
        :section-id="section.id"
      />
    </ul>

    <ProjectAddGrid :section-id="section.id" />
  </article>
</template>
