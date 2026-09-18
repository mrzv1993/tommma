<script setup lang="ts">
import { Search, RotateCcw } from '@lucide/vue'
import { computed } from 'vue'
import type { OperationFilters, ReferenceData } from '@capital/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const props = defineProps<{ modelValue: OperationFilters; references: ReferenceData; hasFilters: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: OperationFilters]; change: []; reset: [] }>()

function update(key: keyof OperationFilters, value?: string | number) {
  emit('update:modelValue', { ...props.modelValue, [key]: value || undefined, page: 1 })
  emit('change')
}

const search = computed({ get: () => props.modelValue.search || '', set: (value) => update('search', value) })
</script>

<template>
  <div class="flex flex-col gap-3 border-b bg-muted/20 p-4">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 2xl:grid-cols-[minmax(220px,1.4fr)_repeat(6,minmax(130px,1fr))_auto]">
      <InputGroup>
        <InputGroupAddon><Search /></InputGroupAddon>
        <InputGroupInput v-model="search" aria-label="Поиск операций" placeholder="ID, tx hash, актив, заметка" />
      </InputGroup>
      <Select :model-value="modelValue.type || 'all'" @update:model-value="update('type', $event === 'all' ? undefined : String($event))">
        <SelectTrigger aria-label="Тип операции"><SelectValue placeholder="Все типы" /></SelectTrigger>
        <SelectContent
          ><SelectGroup>
            <SelectItem value="all">Все типы</SelectItem><SelectItem value="purchase">Покупка</SelectItem>
            <SelectItem value="conversion">Конвертация</SelectItem><SelectItem value="transfer">Перевод</SelectItem>
          </SelectGroup></SelectContent
        >
      </Select>
      <Select
        :model-value="modelValue.assetId || 'all'"
        @update:model-value="update('assetId', $event === 'all' ? undefined : String($event))"
      >
        <SelectTrigger aria-label="Актив"><SelectValue placeholder="Все активы" /></SelectTrigger>
        <SelectContent
          ><SelectGroup
            ><SelectItem value="all">Все активы</SelectItem
            ><SelectItem v-for="asset in references.assets" :key="asset.id" :value="asset.id">{{ asset.symbol }}</SelectItem></SelectGroup
          ></SelectContent
        >
      </Select>
      <Select
        :model-value="modelValue.status || 'all'"
        @update:model-value="update('status', $event === 'all' ? undefined : String($event))"
      >
        <SelectTrigger aria-label="Статус"><SelectValue placeholder="Все статусы" /></SelectTrigger>
        <SelectContent
          ><SelectGroup>
            <SelectItem value="all">Все статусы</SelectItem><SelectItem value="completed">Выполнено</SelectItem
            ><SelectItem value="pending">В обработке</SelectItem> <SelectItem value="needs_review">Требует проверки</SelectItem
            ><SelectItem value="draft">Черновик</SelectItem><SelectItem value="failed">Ошибка</SelectItem><SelectItem value="archived">В архиве</SelectItem>
          </SelectGroup></SelectContent
        >
      </Select>
      <Select
        :model-value="modelValue.locationId || 'all'"
        @update:model-value="update('locationId', $event === 'all' ? undefined : String($event))"
      >
        <SelectTrigger aria-label="Локация"><SelectValue placeholder="Все локации" /></SelectTrigger>
        <SelectContent
          ><SelectGroup
            ><SelectItem value="all">Все локации</SelectItem
            ><SelectItem v-for="location in references.locations" :key="location.id" :value="location.id">{{
              location.name
            }}</SelectItem></SelectGroup
          ></SelectContent
        >
      </Select>
      <Select
        :model-value="modelValue.networkId || 'all'"
        @update:model-value="update('networkId', $event === 'all' ? undefined : String($event))"
      >
        <SelectTrigger aria-label="Сеть"><SelectValue placeholder="Все сети" /></SelectTrigger>
        <SelectContent
          ><SelectGroup
            ><SelectItem value="all">Все сети</SelectItem
            ><SelectItem v-for="network in references.networks" :key="network.id" :value="network.id">{{
              network.name
            }}</SelectItem></SelectGroup
          ></SelectContent
        >
      </Select>
      <Select
        :model-value="modelValue.source || 'all'"
        @update:model-value="update('source', $event === 'all' ? undefined : String($event))"
      >
        <SelectTrigger aria-label="Источник"><SelectValue placeholder="Все источники" /></SelectTrigger>
        <SelectContent
          ><SelectGroup
            ><SelectItem value="all">Все источники</SelectItem><SelectItem value="manual">Вручную</SelectItem
            ><SelectItem value="okx_exchange">OKX Exchange</SelectItem><SelectItem value="okx_wallet">OKX Wallet</SelectItem
            ><SelectItem value="csv">CSV</SelectItem></SelectGroup
          ></SelectContent
        >
      </Select>
      <Button variant="ghost" :disabled="!hasFilters" @click="emit('reset')"><RotateCcw data-icon="inline-start" />Сбросить</Button>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted-foreground">Период:</span>
      <Input
        class="min-w-0 flex-1 sm:w-40 sm:flex-none"
        type="date"
        aria-label="Дата начала"
        :model-value="modelValue.dateFrom"
        @update:model-value="update('dateFrom', String($event))"
      />
      <span class="text-xs text-muted-foreground">—</span>
      <Input
        class="min-w-0 flex-1 sm:w-40 sm:flex-none"
        type="date"
        aria-label="Дата окончания"
        :model-value="modelValue.dateTo"
        @update:model-value="update('dateTo', String($event))"
      />
    </div>
  </div>
</template>
