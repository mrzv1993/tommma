<script setup lang="ts">
import { computed } from 'vue'

import {
  parsePriorityTaskTitle,
  priorityProjectBadgeStyle,
} from '@/components/sections/priority-task-title'

const props = defineProps<{
  title: string
}>()

const parts = computed(() => parsePriorityTaskTitle(props.title))
</script>

<template>
  <span class="priority-task-title-display">
    <span
      v-if="parts.project"
      class="priority-project-badge"
      :data-title-offset="parts.projectOffset"
      :style="priorityProjectBadgeStyle(parts.project)"
    >
      {{ parts.project }}
    </span>
    <span
      v-if="parts.title"
      class="priority-task-title-text"
      :data-title-offset="parts.titleOffset"
    >
      {{ parts.title }}
    </span>
  </span>
</template>

<style scoped>
.priority-task-title-display {
  width: 100%;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px;
}

.priority-project-badge {
  min-height: 18px;
  border: 1px solid var(--priority-project-border);
  border-radius: 999px;
  background: var(--priority-project-bg);
  color: var(--priority-project-text);
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  font-size: 10px;
  line-height: 14px;
  font-weight: 750;
  white-space: nowrap;
}

.priority-task-title-text {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
</style>
