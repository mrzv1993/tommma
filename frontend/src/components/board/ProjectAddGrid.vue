<script setup lang="ts">
import { computed } from 'vue'
import { ListPlus, Plus } from '@lucide/vue'

import { useProjectSidebarContext } from '@/app/project-sidebar-context'

const props = defineProps<{
  sectionId: string
  root?: boolean
  stacked?: boolean
}>()

const app = useProjectSidebarContext()
const sectionAdd = computed(() => app.sectionAddRowProps(app.selectedProjectKey, props.sectionId))
const cardHasValue = computed(
  () =>
    Boolean((app.cardDraftBySection[props.sectionId] || '').trim()) ||
    Boolean(app.addCardEditing[props.sectionId]) ||
    sectionAdd.value.editing,
)

function startCardEdit() {
  if (sectionAdd.value.editing) {
    app.startAddSectionEdit(props.sectionId)
    return
  }
  if (props.root) {
    app.startAddProjectCardEdit()
    return
  }
  app.startAddCardEdit(props.sectionId)
}

function addCard() {
  if (props.root) {
    app.addProjectCard()
    return
  }
  app.addCard(props.sectionId)
}

function cancelCardEdit(event: KeyboardEvent) {
  if (props.root) {
    app.cancelAddProjectCardEdit(event)
    return
  }
  app.cancelAddCardEdit(props.sectionId, event)
}

function handleCardBlur() {
  if (props.root) {
    app.handleAddProjectCardBlur()
    return
  }
  app.handleAddCardBlur(props.sectionId)
}
</script>

<template>
  <div
    :class="[
      stacked ? 'project-root-add-stack' : 'project-add-grid',
      root && !stacked ? 'project-root-add-grid' : '',
      !root ? 'project-add-grid-hover' : '',
      {
        'project-add-grid-visible': !root && cardHasValue,
        'project-card-drop-target-surface': app.isCardDropContainerTarget(sectionId),
      },
    ]"
    @dragover="app.handleCardDragOver($event, sectionId, null)"
    @drop="app.handleCardDrop($event, sectionId, null)"
  >
    <div class="project-card-add-row" :class="{ 'has-value': cardHasValue }">
      <button class="plus add-task-trigger add-task-check-trigger" type="button" @click.stop.prevent="startCardEdit">
        <ListPlus v-if="sectionAdd.editing" class="project-section-icon" />
        <Plus v-else-if="!app.addCardEditing[sectionId]" class="add-task-plus-icon" />
      </button>
      <input
        v-if="sectionAdd.editing"
        v-model="app.sectionDraftByProject[app.selectedProjectKey]"
        class="add-input add-input-active"
        :data-add-section-input="app.selectedProjectKey"
        placeholder="Новый раздел"
        @keydown.enter.prevent="app.addSection"
        @keydown.esc.prevent="app.cancelAddSectionEdit(app.selectedProjectKey, $event)"
        @blur="app.handleAddSectionBlur(app.selectedProjectKey)"
      />
      <input
        v-else-if="app.addCardEditing[sectionId]"
        v-model="app.cardDraftBySection[sectionId]"
        class="add-input add-input-active"
        :data-add-card-input="sectionId"
        placeholder="Новая карточка"
        @keydown.enter.prevent="addCard"
        @keydown.esc.prevent="cancelCardEdit"
        @blur="handleCardBlur"
      />
      <button v-else class="add-input add-input-trigger" type="button" @click.stop.prevent="startCardEdit">
        Добавить карточку
      </button>
    </div>
    <div
      class="project-section-add-row"
      :class="{
        'project-section-add-row-wide': stacked,
        'has-value': sectionAdd.hasValue,
        'project-section-add-row-expanded': !stacked && sectionAdd.editing,
      }"
    >
      <button
        class="project-section-icon-btn"
        type="button"
        aria-label="Добавить раздел"
        title="Добавить раздел"
        @click.stop.prevent="app.startAddSectionEdit(sectionId)"
      >
        <ListPlus class="project-section-icon" />
      </button>
      <button
        v-if="stacked"
        class="add-input add-input-trigger"
        type="button"
        @click.stop.prevent="app.startAddSectionEdit(sectionId)"
      >
        Добавить раздел
      </button>
    </div>
  </div>
</template>
