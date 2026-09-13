<script setup lang="ts">
defineProps<{ modelValue: 'tasks' | 'goals' }>()
const emit = defineEmits<{ 'update:modelValue': [value: 'tasks' | 'goals'] }>()
</script>

<template>
  <div class="priority-mode-switch" role="group" aria-label="Тип приоритетов">
    <button v-for="tab in (['tasks', 'goals'] as const)" :key="tab" type="button" :aria-pressed="modelValue === tab" @click="emit('update:modelValue', tab)">{{ tab === 'tasks' ? 'Задачи' : 'Цели' }}</button>
  </div>
</template>

<style scoped>
.priority-mode-switch { display: inline-flex; flex-shrink: 0; gap: 3px; padding: 3px; border: 1px solid #d8e1ef; border-radius: 9px; background: #e7ecf4; }
button { min-width: 65px; padding: 6px 12px; border: 0; border-radius: 6px; background: transparent; color: #687489; font: 600 13px Inter, sans-serif; cursor: pointer; }
button[aria-pressed="true"] { color: #1f3d6e; background: white; box-shadow: 0 1px 3px #203d6e15; }
button:hover { color: #1f3d6e; }
button:focus-visible { outline: 2px solid #2455be; outline-offset: 2px; }
</style>
