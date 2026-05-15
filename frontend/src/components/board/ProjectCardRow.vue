<script setup lang="ts">
import { Check } from '@lucide/vue'

import { useProjectSidebarContext } from '@/app/project-sidebar-context'
import type { CardItem } from '@/app/project-model'

defineProps<{
  card: CardItem
  sectionId: string
}>()

const app = useProjectSidebarContext()
</script>

<template>
  <li
    class="project-card-row"
    :class="app.cardRowDropClass(card.id)"
    draggable="true"
    @dragstart="app.handleCardDragStart($event, card.id)"
    @dragend="app.handleCardDragEnd"
    @dragover="app.handleCardDragOver($event, sectionId, card.id)"
    @drop="app.handleCardDrop($event, sectionId, card.id)"
  >
    <button
      class="project-card-checkbox"
      :class="{ done: card.completed }"
      type="button"
      :aria-label="card.completed ? 'Снять отметку' : 'Отметить выполненным'"
      @click.stop.prevent="app.toggleCardCompleted(card.id)"
    >
      <Check v-if="card.completed" class="project-card-check-icon" />
    </button>
    <input
      v-if="app.editingCardId === card.id"
      v-model="app.editingCardDraft"
      class="project-card-title-input"
      @keydown.enter.prevent="app.submitCardRename"
      @keydown.esc.prevent="app.editingCardId = ''"
      @blur="app.submitCardRename"
    />
    <span
      v-else
      class="project-card-title"
      :class="{ done: card.completed }"
      @dblclick.stop="app.startCardRenameByDoubleClick(card)"
    >
      {{ card.title }}
    </span>
    <div
      class="project-item-menu-wrap"
      tabindex="-1"
      @focusout="app.closeMenuOnBlur('card', card.id, $event)"
      @keydown.esc.prevent="app.cardMenuOpenId = ''"
    >
      <button class="project-item-menu-btn" type="button" @click="app.toggleCardMenu(card.id, $event)">⋯</button>
      <div v-if="app.cardMenuOpenId === card.id" class="project-item-menu">
        <button type="button" @click="app.startCardRename(card)">Редактировать карточку</button>
        <button type="button" class="danger" @click="app.deleteCard(card.id)">Удалить карточку</button>
      </div>
    </div>
  </li>
</template>
