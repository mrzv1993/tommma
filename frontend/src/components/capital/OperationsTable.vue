<script setup lang="ts">
import { computed } from 'vue'
import { format, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'
import { divideDecimal, formatDecimal, formatRub } from '@capital/domain'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  CircleAlert,
  Clock3,
  MoreHorizontal,
  Pencil,
  ShoppingCart,
  Trash2,
} from '@lucide/vue'
import type { Asset, Location, Network, Operation, OperationSort } from '@capital/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const props = defineProps<{
  operations: Operation[]
  assets: Asset[]
  locations: Location[]
  networks: Network[]
  disabled?: boolean
  sort: OperationSort
}>()
const emit = defineEmits<{ edit: [operation: Operation]; archive: [operation: Operation]; sort: [] }>()

const asset = (id: string) => props.assets.find((item) => item.id === id)
const location = (id?: string) => props.locations.find((item) => item.id === id)?.name || '—'
const network = (id?: string) => props.networks.find((item) => item.id === id)?.name
const shortAddress = (value?: string) => (value && value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value)
const amount = (value: string) => formatDecimal(value, 8)
const conversionRate = (operation: Operation) => {
  if (operation.type !== 'conversion') return null
  const outgoing = operation.legs.find((leg) => leg.direction === 'out')
  const incoming = operation.legs.find((leg) => leg.direction === 'in')
  if (!outgoing || !incoming) return null
  const rate = divideDecimal(incoming.amount, outgoing.amount)
  if (!rate) return null
  return `1 ${asset(outgoing.assetId)?.symbol} ≈ ${amount(rate)} ${asset(incoming.assetId)?.symbol}`
}

const groups = computed(() => {
  const result: Array<{ key: string; label: string; operations: Operation[] }> = []
  for (const operation of props.operations) {
    const date = new Date(operation.occurredAt)
    const key = format(date, 'yyyy-MM-dd')
    let group = result.find((item) => item.key === key)
    if (!group) {
      const label = isToday(date) ? 'Сегодня' : isYesterday(date) ? 'Вчера' : format(date, 'd MMMM yyyy', { locale: ru })
      group = { key, label, operations: [] }
      result.push(group)
    }
    group.operations.push(operation)
  }
  return result
})

const meta = {
  purchase: { label: 'Покупка', icon: ShoppingCart },
  conversion: { label: 'Конвертация', icon: ArrowDownUp },
  transfer: { label: 'Перевод', icon: ArrowRight },
}
const statusMeta = {
  completed: { label: 'Выполнено', icon: CheckCircle2, variant: 'secondary' as const },
  pending: { label: 'В обработке', icon: Clock3, variant: 'outline' as const },
  needs_review: { label: 'Требует проверки', icon: CircleAlert, variant: 'outline' as const },
  draft: { label: 'Черновик', icon: Pencil, variant: 'outline' as const },
  failed: { label: 'Ошибка', icon: CircleAlert, variant: 'destructive' as const },
  archived: { label: 'В архиве', icon: Trash2, variant: 'outline' as const },
}
const sourceLabel = { manual: 'Вручную', okx_exchange: 'OKX Exchange', okx_wallet: 'OKX Wallet', csv: 'CSV' }
</script>

<template>
  <Table>
    <TableHeader
      ><TableRow>
        <TableHead class="w-36">
          <Button
            variant="ghost"
            size="sm"
            :aria-label="sort === 'newest' ? 'Дата: сначала новые' : 'Дата: сначала старые'"
            @click="emit('sort')"
          >
            Дата и время
            <ArrowDown v-if="sort === 'newest'" data-icon="inline-end" />
            <ArrowUp v-else data-icon="inline-end" />
          </Button> </TableHead
        ><TableHead>Тип операции</TableHead><TableHead>Активы</TableHead> <TableHead>Количество</TableHead
        ><TableHead class="max-xl:hidden">₽ Сумма / Курс</TableHead> <TableHead class="max-xl:hidden">Комиссия</TableHead
        ><TableHead>Локация</TableHead><TableHead>Статус</TableHead
        ><TableHead class="w-12"><span class="sr-only">Действия</span></TableHead>
      </TableRow></TableHeader
    >
    <TableBody>
      <template v-for="group in groups" :key="group.key">
        <TableRow class="bg-muted/40 hover:bg-muted/40"
          ><TableCell colspan="9" class="py-2 text-xs font-semibold">{{ group.label }}</TableCell></TableRow
        >
        <TableRow
          v-for="operation in group.operations"
          :key="operation.id"
          class="group cursor-pointer"
          @dblclick="!disabled && operation.status !== 'archived' && emit('edit', operation)"
        >
          <TableCell class="font-medium tabular-nums">{{ format(new Date(operation.occurredAt), 'HH:mm') }}</TableCell>
          <TableCell
            ><div class="flex items-start gap-2">
              <component :is="meta[operation.type].icon" class="mt-0.5 text-muted-foreground size-4" />
              <div>
                <span>{{ meta[operation.type].label }}</span>
                <p class="text-xs text-muted-foreground">{{ sourceLabel[operation.source] }}</p>
              </div>
            </div></TableCell
          >
          <TableCell
            ><div class="flex flex-col gap-1">
              <span v-for="leg in operation.legs.filter((item) => item.direction !== 'fee')" :key="leg.id" class="font-medium">{{
                asset(leg.assetId)?.symbol
              }}</span>
            </div></TableCell
          >
          <TableCell
            ><div class="flex flex-col gap-1 tabular-nums">
              <span v-for="leg in operation.legs.filter((item) => item.direction !== 'fee')" :key="leg.id"
                >{{ leg.direction === 'out' ? '−' : '+' }}{{ amount(leg.amount) }}</span
              >
            </div></TableCell
          >
          <TableCell class="max-xl:hidden"
            ><span v-if="operation.legs.find((leg) => leg.fiatValue)">{{
              formatRub(operation.legs.find((leg) => leg.fiatValue)!.fiatValue!)
            }}</span
            ><span v-else-if="conversionRate(operation)" class="text-xs">{{ conversionRate(operation) }}</span
            ><span v-else class="text-muted-foreground">—</span></TableCell
          >
          <TableCell class="max-xl:hidden"
            ><span v-if="operation.legs.find((leg) => leg.direction === 'fee')"
              >{{ amount(operation.legs.find((leg) => leg.direction === 'fee')!.amount) }}
              {{ asset(operation.legs.find((leg) => leg.direction === 'fee')!.assetId)?.symbol }}</span
            ><span v-else class="text-muted-foreground">—</span></TableCell
          >
          <TableCell
            ><div class="max-w-48 text-sm">
              <span>{{ location(operation.locationFromId) }}</span
              ><template v-if="operation.locationToId"
                ><span class="text-muted-foreground"> → </span><span>{{ location(operation.locationToId) }}</span></template
              >
              <p v-if="network(operation.networkId)" class="text-xs text-muted-foreground">{{ network(operation.networkId) }}</p>
              <p v-if="operation.destinationAddress" class="font-mono text-xs text-muted-foreground">
                {{ shortAddress(operation.destinationAddress) }}
              </p>
            </div></TableCell
          >
          <TableCell
            ><Badge :variant="statusMeta[operation.status].variant"
              ><component :is="statusMeta[operation.status].icon" />{{ statusMeta[operation.status].label }}</Badge
            ></TableCell
          >
          <TableCell
            ><DropdownMenu
              ><DropdownMenuTrigger as-child
                ><Button variant="ghost" size="icon-sm" aria-label="Действия операции"><MoreHorizontal /></Button></DropdownMenuTrigger
              ><DropdownMenuContent align="end"
                ><DropdownMenuGroup
                  ><DropdownMenuItem :disabled="disabled || operation.status === 'archived'" @select="emit('edit', operation)"><Pencil />Изменить</DropdownMenuItem
                  ><DropdownMenuItem :disabled="disabled || operation.status === 'archived'" variant="destructive" @select="emit('archive', operation)"
                    ><Trash2 />В архив</DropdownMenuItem
                  ></DropdownMenuGroup
                ></DropdownMenuContent
              ></DropdownMenu
            ></TableCell
          >
        </TableRow>
      </template>
    </TableBody>
  </Table>
</template>
