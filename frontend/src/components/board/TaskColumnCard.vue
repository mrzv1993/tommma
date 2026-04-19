<script setup lang="ts">
import type { TaskColumn, TaskItem } from '@/lib/app-state'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  columnId: TaskColumn
  label: string
  description: string
  progressPercent: number
  tasks: TaskItem[]
  draft: string
  editingTaskId: string | null
  editingDraft: string
  subtaskDrafts: Record<string, string>
  taskElapsed: (task: TaskItem) => string
  isTaskRunning: (task: TaskItem) => boolean
}>()

const emit = defineEmits<{
  (e: 'update:draft', value: string): void
  (e: 'update:editing-draft', value: string): void
  (e: 'update:subtask-draft', payload: { taskId: string; value: string }): void
  (e: 'add-task'): void
  (e: 'drop-column'): void
  (e: 'drag-start', taskId: string): void
  (e: 'drag-end'): void
  (e: 'drop-task', targetTaskId: string): void
  (e: 'toggle-task', taskId: string): void
  (e: 'start-edit', payload: { taskId: string; title: string }): void
  (e: 'save-edit'): void
  (e: 'cancel-edit'): void
  (e: 'change-column', payload: { taskId: string; value: string }): void
  (e: 'change-recurrence', payload: { taskId: string; value: string }): void
  (e: 'start-timer', taskId: string): void
  (e: 'pause-timer', taskId: string): void
  (e: 'stop-timer', taskId: string): void
  (e: 'toggle-subtask', payload: { taskId: string; subtaskId: string }): void
  (e: 'remove-subtask', payload: { taskId: string; subtaskId: string }): void
  (e: 'add-subtask', taskId: string): void
  (e: 'remove-task', taskId: string): void
}>()
</script>

<template>
  <Card class="min-h-[520px]">
    <CardHeader>
      <div class="flex items-center justify-between gap-2">
        <CardTitle>{{ props.label }}</CardTitle>
        <Badge variant="outline">{{ props.progressPercent }}%</Badge>
      </div>
      <CardDescription>{{ props.description }}</CardDescription>
    </CardHeader>

    <CardContent class="flex flex-col gap-3">
      <form class="flex gap-2" @submit.prevent="emit('add-task')">
        <Input
          :model-value="props.draft"
          :placeholder="`Добавить в ${props.label}`"
          maxlength="220"
          @update:model-value="(value) => emit('update:draft', String(value ?? ''))"
        />
        <Button type="submit">+</Button>
      </form>

      <div class="flex flex-col gap-2">
        <div class="min-h-8 rounded-md" @dragover.prevent @drop.prevent="emit('drop-column')" />

        <div
          v-for="task in props.tasks"
          :key="task.id"
          class="bg-muted/40 flex items-start justify-between gap-2 rounded-lg border p-3"
          draggable="true"
          @dragstart="emit('drag-start', task.id)"
          @dragend="emit('drag-end')"
          @dragover.prevent
          @drop.prevent="emit('drop-task', task.id)"
        >
          <div class="min-w-0 flex-1 space-y-2">
            <Input
              v-if="props.editingTaskId === task.id"
              :model-value="props.editingDraft"
              maxlength="220"
              @update:model-value="(value) => emit('update:editing-draft', String(value ?? ''))"
              @keydown.enter.prevent="emit('save-edit')"
              @keydown.esc.prevent="emit('cancel-edit')"
            />
            <button
              v-else
              type="button"
              class="text-left text-sm"
              :class="task.completed ? 'text-muted-foreground line-through' : 'text-foreground'"
              @click="emit('toggle-task', task.id)"
            >
              {{ task.title }}
            </button>

            <div class="flex flex-wrap items-center gap-2">
              <select
                class="bg-background h-8 rounded-md border px-2 text-xs"
                :value="task.column"
                @change="emit('change-column', { taskId: task.id, value: ($event.target as HTMLSelectElement).value })"
              >
                <option value="todo">To Do</option>
                <option value="not-do">Not Do</option>
                <option value="anti-todo">Anti-To Do</option>
              </select>

              <select
                class="bg-background h-8 rounded-md border px-2 text-xs"
                :value="task.recurrence"
                :disabled="task.recurrenceParentId !== null"
                @change="emit('change-recurrence', { taskId: task.id, value: ($event.target as HTMLSelectElement).value })"
              >
                <option value="none">Без повтора</option>
                <option value="daily">Ежедневно</option>
                <option value="weekly">Еженедельно</option>
              </select>

              <Badge variant="outline">{{ task.dateKey }}</Badge>
              <Badge v-if="task.recurrenceParentId" variant="outline">Инстанс</Badge>
              <Badge variant="secondary">{{ props.taskElapsed(task) }}</Badge>
            </div>

            <div class="flex items-center gap-1">
              <Button
                v-if="!props.isTaskRunning(task)"
                type="button"
                variant="outline"
                size="sm"
                @click="emit('start-timer', task.id)"
              >
                Play
              </Button>
              <Button
                v-if="props.isTaskRunning(task)"
                type="button"
                variant="outline"
                size="sm"
                @click="emit('pause-timer', task.id)"
              >
                Pause
              </Button>
              <Button type="button" variant="outline" size="sm" @click="emit('stop-timer', task.id)">
                Stop
              </Button>
            </div>

            <div class="space-y-1">
              <div
                v-for="subtask in task.subtasks"
                :key="subtask.id"
                class="bg-background/80 flex items-center justify-between gap-2 rounded border px-2 py-1"
              >
                <button
                  type="button"
                  class="text-left text-xs"
                  :class="subtask.completed ? 'text-muted-foreground line-through' : 'text-foreground'"
                  @click="emit('toggle-subtask', { taskId: task.id, subtaskId: subtask.id })"
                >
                  {{ subtask.title }}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  @click="emit('remove-subtask', { taskId: task.id, subtaskId: subtask.id })"
                >
                  ×
                </Button>
              </div>

              <form class="flex gap-1" @submit.prevent="emit('add-subtask', task.id)">
                <Input
                  :model-value="props.subtaskDrafts[task.id] || ''"
                  placeholder="Подзадача"
                  maxlength="140"
                  class="h-8 text-xs"
                  @update:model-value="(value) => emit('update:subtask-draft', { taskId: task.id, value: String(value ?? '') })"
                />
                <Button type="submit" size="sm">+</Button>
              </form>
            </div>
          </div>

          <div class="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" @click="emit('start-edit', { taskId: task.id, title: task.title })">
              Edit
            </Button>
            <Button type="button" variant="ghost" size="sm" @click="emit('remove-task', task.id)">×</Button>
          </div>
        </div>

        <p v-if="props.tasks.length === 0" class="text-muted-foreground text-xs">Пока пусто</p>
      </div>
    </CardContent>
  </Card>
</template>
