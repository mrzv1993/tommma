<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

defineProps<{
  nickname: string
  email: string
  done: number
  total: number
  percent: number
  selectedDateLabel: string
  busy: boolean
}>()

const emit = defineEmits<{
  (e: 'shift-date', delta: number): void
  (e: 'today'): void
  (e: 'logout'): void
}>()
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Сессия</CardTitle>
      <CardDescription>
        Вошли как {{ nickname }} ({{ email }}). Прогресс и задачи сохраняются в PostgreSQL.
      </CardDescription>
    </CardHeader>
    <CardFooter class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Badge variant="outline">{{ done }}/{{ total }}</Badge>
        <Badge variant="secondary">{{ percent }}%</Badge>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="emit('shift-date', -1)">← День</Button>
        <Badge variant="outline">{{ selectedDateLabel }}</Badge>
        <Button variant="outline" size="sm" @click="emit('today')">Сегодня</Button>
        <Button variant="outline" size="sm" @click="emit('shift-date', 1)">День →</Button>
      </div>

      <Button :disabled="busy" variant="outline" @click="emit('logout')">Выйти</Button>
    </CardFooter>
  </Card>
</template>
