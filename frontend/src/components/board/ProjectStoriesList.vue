<script setup lang="ts">
import { useProjectSidebarContext } from '@/app/project-sidebar-context'

const app = useProjectSidebarContext()
</script>

<template>
  <div class="project-stories">
    <button
      v-for="story in app.projectStories"
      :key="story.key"
      class="project-story"
      :class="{ active: app.selectedProjectKey === story.key }"
      type="button"
      :aria-label="story.name"
      :title="story.name"
      draggable="true"
      @click="app.selectedProjectKey = story.key"
      @dragstart="app.handleStoryDragStart(story.key)"
      @dragend="app.handleStoryDragEnd"
      @dragover="app.handleStoryDragOver($event, story.key)"
    >
      <span class="project-story-avatar-wrap" :style="{ '--story-progress': `${story.progressPercent}%` }">
        <span class="project-story-avatar">{{ story.initials }}</span>
        <span v-if="story.openCardsCount > 0" class="project-story-badge">{{ story.openCardsBadge }}</span>
      </span>
    </button>
    <button
      class="project-story project-story-add"
      type="button"
      aria-label="Добавить проект"
      title="Добавить проект"
      @click="app.addProjectStory"
    >
      <span class="project-story-avatar">+</span>
    </button>
  </div>
</template>
