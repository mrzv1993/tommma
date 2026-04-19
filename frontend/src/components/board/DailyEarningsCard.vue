<script setup lang="ts">
import type { DailyProjectEarning } from '@/lib/app-state'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  dateLabel: string
  items: DailyProjectEarning[]
  total: number
}>()

const emit = defineEmits<{
  (e: 'add-row'): void
  (e: 'update-row', payload: { id: string; projectName?: string; amount?: number }): void
  (e: 'remove-row', id: string): void
}>()

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
</script>

<template>
  <Card class="min-h-[280px]">
    <CardHeader>
      <div class="flex items-center justify-between gap-2">
        <CardTitle>Заработок за день</CardTitle>
        <Badge variant="secondary">{{ formatMoney(props.total) }}</Badge>
      </div>
      <CardDescription>По проектам на {{ props.dateLabel }}</CardDescription>
    </CardHeader>

    <CardContent class="flex flex-col gap-3">
      <div class="grid gap-2 md:grid-cols-[1fr_160px_auto]" v-for="item in props.items" :key="item.id">
        <Input
          :model-value="item.projectName"
          placeholder="Название проекта"
          maxlength="120"
          @change="emit('update-row', { id: item.id, projectName: ($event.target as HTMLInputElement).value })"
        />

        <Input
          type="number"
          min="0"
          step="0.01"
          :model-value="String(item.amount)"
          placeholder="0"
          @change="emit('update-row', { id: item.id, amount: Number(($event.target as HTMLInputElement).value || 0) })"
        />

        <Button type="button" variant="ghost" @click="emit('remove-row', item.id)">×</Button>
      </div>

      <p v-if="props.items.length === 0" class="text-muted-foreground text-sm">
        Пока нет проектов. Добавьте первую строку.
      </p>

      <div class="flex justify-end">
        <Button type="button" variant="outline" @click="emit('add-row')">+ Добавить проект</Button>
      </div>
    </CardContent>
  </Card>
</template>
