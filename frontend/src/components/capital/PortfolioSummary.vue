<script setup lang="ts">
import { Coins, ReceiptRussianRuble, WalletCards } from '@lucide/vue'
import { formatRub, type PortfolioResult } from '@capital/domain'
import type { ReferenceData } from '@capital/contracts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const props = defineProps<{ portfolio: PortfolioResult; references: ReferenceData }>()
const totalAssets = () => new Set(props.portfolio.positions.map((position) => position.assetId)).size
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <Card
      ><CardHeader class="flex flex-row items-center justify-between"
        ><div>
          <CardDescription>Вложено</CardDescription><CardTitle class="mt-1 tabular-nums">{{ formatRub(portfolio.investedRub) }}</CardTitle>
        </div>
        <ReceiptRussianRuble class="size-5 text-muted-foreground" /></CardHeader
    ></Card>
    <Card
      ><CardHeader class="flex flex-row items-center justify-between"
        ><div>
          <CardDescription>Активов на балансе</CardDescription><CardTitle class="mt-1">{{ totalAssets() }}</CardTitle>
        </div>
        <Coins class="size-5 text-muted-foreground" /></CardHeader
    ></Card>
    <Card
      ><CardHeader class="flex flex-row items-center justify-between"
        ><div>
          <CardDescription>Комиссии по себестоимости</CardDescription
          ><CardTitle class="mt-1 tabular-nums">{{ formatRub(portfolio.feesRub) }}</CardTitle>
        </div>
        <WalletCards class="size-5 text-muted-foreground" /></CardHeader
      ><CardContent class="sr-only">{{ references.assets.length }} активов в справочнике</CardContent></Card
    >
  </div>
</template>
