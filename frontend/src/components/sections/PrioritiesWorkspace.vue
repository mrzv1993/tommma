<script setup lang="ts">
import { ref } from 'vue'
import type { PriorityListBindings } from '@/app/priority-list-bindings'
import { useGoalState } from '@/app/goal-state'
import type { PriorityMode } from '@/lib/priority-mode'
import PrioritiesSection from './PrioritiesSection.vue'
import ProcessSection from './ProcessSection.vue'
import GoalStatisticsSection from './GoalStatisticsSection.vue'

const taskProps = defineProps<PriorityListBindings>()
const emit = defineEmits<{ openStatistics: [] }>()
const mode = ref<PriorityMode>('tasks')
const statisticsOpen = ref(false)
const { goals, bindings, load, loading, loaded, error } = useGoalState()
function selectMode(next: PriorityMode) {
  mode.value = next
  if (next === 'goals') void load()
}
</script>

<template>
  <GoalStatisticsSection v-if="statisticsOpen" :goals="goals" :loading="loading" :error="error" @back="statisticsOpen = false" @retry="load" />
  <KeepAlive>
    <ProcessSection v-if="!statisticsOpen && mode === 'process'" @change-mode="selectMode" />
    <PrioritiesSection v-else-if="!statisticsOpen && mode !== 'process'" :key="mode" v-bind="mode === 'tasks' ? taskProps : bindings" :mode="mode"
      :ready="mode === 'tasks' || loaded" :loading="mode === 'goals' && loading" :load-error="mode === 'goals' ? error : ''"
      @change-mode="selectMode" @retry="load" @open-statistics="mode === 'tasks' ? emit('openStatistics') : (statisticsOpen = true)" />
  </KeepAlive>
</template>
