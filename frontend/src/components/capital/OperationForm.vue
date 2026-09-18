<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  operationInputSchema,
  validateOperationReferences,
  validateTxHash,
  type NormalizedOperationInput,
  type Operation,
  type OperationType,
  type ReferenceData,
} from '@capital/contracts'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel, FieldSet, FieldLegend } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const props = defineProps<{ type: OperationType; operation?: Operation | null; references: ReferenceData; saving: boolean }>()
const requiresReview = computed(() => props.operation?.status === 'needs_review' || (props.operation && props.operation.source !== 'manual' && props.operation.status !== 'completed'))
const emit = defineEmits<{ submit: [input: NormalizedOperationInput, confirmReview: boolean]; cancel: []; changeType: [type: OperationType] }>()

type FormState = {
  occurredAt: string
  status: Operation['status']
  fiatAmount: string
  assetIn: string
  amountIn: string
  assetOut: string
  amountOut: string
  asset: string
  amountSent: string
  amountReceived: string
  locationFrom: string
  locationTo: string
  networkId: string
  feeAmount: string
  feeAsset: string
  txHash: string
  destinationAddress: string
  externalId: string
  note: string
}

const initial = (): FormState => ({
  occurredAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  status: 'completed',
  fiatAmount: '',
  assetIn: props.type === 'purchase' ? 'usdt' : 'usdc',
  amountIn: '',
  assetOut: 'usdt',
  amountOut: '',
  asset: 'usdt',
  amountSent: '',
  amountReceived: '',
  locationFrom: props.type === 'purchase' ? 'fiat' : 'okx',
  locationTo: props.type === 'purchase' ? 'okx' : 'okx-wallet',
  networkId: '',
  feeAmount: '',
  feeAsset: props.type === 'purchase' ? 'usdt' : '',
  txHash: '',
  destinationAddress: '',
  externalId: '',
  note: '',
})
const form = reactive<FormState>(initial())
const confirmed = ref(false)
const errors = reactive<Record<string, string>>({})

const cryptoAssets = computed(() => props.references.assets.filter((asset) => asset.kind === 'crypto'))
const title = computed(() =>
  props.operation
    ? 'Изменить операцию'
    : { purchase: 'Новая покупка', conversion: 'Новая конвертация', transfer: 'Новый перевод' }[props.type],
)

function hasFee() {
  const value = form.feeAmount.trim().replace(',', '.')
  return value !== '' && !/^0+(\.0*)?$/.test(value)
}

function hydrate(operation?: Operation | null) {
  confirmed.value = false
  Object.assign(form, initial())
  if (!operation) return
  const incoming = operation.legs.find((leg) => leg.direction === 'in')
  const outgoing = operation.legs.find((leg) => leg.direction === 'out')
  const fee = operation.legs.find((leg) => leg.direction === 'fee')
  Object.assign(form, {
    occurredAt: new Date(new Date(operation.occurredAt).getTime() - new Date(operation.occurredAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
    status: operation.status,
    fiatAmount: operation.type === 'purchase' ? outgoing?.fiatValue || outgoing?.amount || '' : '',
    assetIn: incoming?.assetId || 'usdc',
    amountIn: incoming?.amount || '',
    assetOut: outgoing?.assetId || 'usdt',
    amountOut: outgoing?.amount || '',
    asset: outgoing?.assetId || 'usdt',
    amountSent: outgoing?.amount || '',
    amountReceived: incoming?.amount || '',
    locationFrom: operation.locationFromId || '',
    locationTo: operation.locationToId || '',
    networkId: operation.networkId || '',
    feeAmount: fee?.amount || '',
    feeAsset: fee?.assetId || '',
    txHash: operation.txHash || '',
    destinationAddress: operation.destinationAddress || '',
    externalId: operation.externalId || '',
    note: operation.note || '',
  })
}
watch(
  () => [props.operation, props.type] as const,
  ([operation]) => hydrate(operation),
  { immediate: true },
)

function createPayload(): unknown {
  const date = new Date(form.occurredAt)
  const common = {
    type: props.type,
    occurredAt: Number.isNaN(date.getTime()) ? form.occurredAt : date.toISOString(),
    timezone: props.operation?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok',
    status: confirmed.value && requiresReview.value ? 'completed' : form.status,
    source: props.operation?.source ?? ('manual' as const),
    externalId: form.externalId || undefined,
    externalRevision: props.operation?.externalRevision,
    logIndex: props.operation?.logIndex,
    networkId: form.networkId || undefined,
    txHash: form.txHash || undefined,
    destinationAddress: form.destinationAddress || undefined,
    note: form.note || undefined,
  }
  if (props.type === 'purchase')
    return {
      ...common,
      locationFromId: 'fiat',
      locationToId: form.locationTo,
      legs: [
        { direction: 'out', assetId: 'rub', amount: form.fiatAmount, fiatValue: form.fiatAmount, locationId: 'fiat' },
        { direction: 'in', assetId: form.assetIn, amount: form.amountIn, locationId: form.locationTo },
        ...(hasFee()
          ? [{ direction: 'fee', assetId: form.feeAsset || form.assetIn, amount: form.feeAmount, locationId: form.locationTo }]
          : []),
      ],
    }
  if (props.type === 'conversion')
    return {
      ...common,
      locationFromId: form.locationFrom,
      locationToId: form.locationFrom,
      legs: [
        { direction: 'out', assetId: form.assetOut, amount: form.amountOut, locationId: form.locationFrom },
        { direction: 'in', assetId: form.assetIn, amount: form.amountIn, locationId: form.locationFrom },
        ...(hasFee()
          ? [{ direction: 'fee', assetId: form.feeAsset || form.assetOut, amount: form.feeAmount, locationId: form.locationFrom }]
          : []),
      ],
    }
  return {
    ...common,
    locationFromId: form.locationFrom,
    locationToId: form.locationTo,
    legs: [
      { direction: 'out', assetId: form.asset, amount: form.amountSent, locationId: form.locationFrom },
      { direction: 'in', assetId: form.asset, amount: form.amountReceived || form.amountSent, locationId: form.locationTo },
      ...(hasFee()
        ? [{ direction: 'fee', assetId: form.feeAsset || form.asset, amount: form.feeAmount, locationId: form.locationFrom }]
        : []),
    ],
  }
}

function submit() {
  if (props.saving) return
  Object.keys(errors).forEach((key) => delete errors[key])
  const payload = createPayload() as NormalizedOperationInput
  if (props.operation) {
    const previous = props.operation
    const displayedDate = new Date(new Date(previous.occurredAt).getTime() - new Date(previous.occurredAt).getTimezoneOffset() * 60000).toISOString().slice(0,16)
    if (form.occurredAt === displayedDate) payload.occurredAt = previous.occurredAt
    payload.legs = payload.legs.map((leg, index) => {
      const original = previous.legs[index]
      return original && original.direction === leg.direction && original.assetId === leg.assetId && original.amount === leg.amount
        ? { ...leg, fiatValue: original.fiatValue ?? leg.fiatValue, unitPrice: original.unitPrice ?? leg.unitPrice }
        : leg
    })
    payload.legs.push(...previous.legs.filter(l => l.direction === 'fee').slice(1).map(l => ({ ...l, fiatValue: l.fiatValue ?? undefined, unitPrice: l.unitPrice ?? undefined })))
  }
  const parsed = operationInputSchema.safeParse(payload)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [section, index, field] = issue.path
      let key = typeof section === 'string' ? section : 'form'
      if (section === 'locationFromId') key = 'locationFrom'
      if (section === 'locationToId') key = 'locationTo'
      if (section === 'legs' && field === 'amount' && typeof index === 'number') {
        key =
          index === 2
            ? 'feeAmount'
            : props.type === 'purchase'
              ? index === 0
                ? 'fiatAmount'
                : 'amountIn'
              : props.type === 'conversion'
                ? index === 0
                  ? 'amountOut'
                  : 'amountIn'
                : index === 0
                  ? 'amountSent'
                  : 'amountReceived'
      } else if (section === 'legs') key = 'form'
      errors[key] = issue.message
    }
    return
  }
  const referenceIssues = validateOperationReferences(parsed.data, props.references)
  if (referenceIssues.length) errors.form = referenceIssues.join('. ')
  const txHashIssue = validateTxHash(
    parsed.data.txHash,
    props.references.networks.find((network) => network.id === parsed.data.networkId),
  )
  if (txHashIssue) errors.txHash = txHashIssue
  if (Object.keys(errors).length) return
  emit('submit', parsed.data, confirmed.value)
}
</script>

<template>
  <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="submit">
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <FieldGroup>
        <FieldSet>
          <FieldLegend>{{ title }}</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel>Тип операции</FieldLabel>
              <ToggleGroup
                type="single"
                variant="outline"
                :model-value="type"
                aria-label="Тип операции"
                @update:model-value="$event && emit('changeType', $event as OperationType)"
              >
                <ToggleGroupItem value="purchase">Покупка</ToggleGroupItem>
                <ToggleGroupItem value="conversion">Конвертация</ToggleGroupItem>
                <ToggleGroupItem value="transfer">Перевод</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field :data-invalid="!!errors.occurredAt"
                ><FieldLabel for="occurred-at">Дата и время</FieldLabel
                ><Input
                  id="occurred-at"
                  v-model="form.occurredAt"
                  type="datetime-local"
                  :aria-invalid="!!errors.occurredAt"
                  required
                /><FieldError v-if="errors.occurredAt">{{ errors.occurredAt }}</FieldError></Field
              >
              <Field
                ><FieldLabel>Статус</FieldLabel
                ><Select v-model="form.status"
                  ><SelectTrigger aria-label="Статус"><SelectValue /></SelectTrigger
                  ><SelectContent
                    ><SelectGroup
                      ><SelectItem v-if="!requiresReview" value="completed">Выполнено</SelectItem><SelectItem value="pending">В обработке</SelectItem
                      ><SelectItem value="draft">Черновик</SelectItem><SelectItem value="needs_review">Требует проверки</SelectItem><SelectItem value="failed">Не выполнена</SelectItem></SelectGroup
                    ></SelectContent
                  ></Select
                ></Field
              >
            </div>

            <template v-if="type === 'purchase'">
              <Field :data-invalid="!!errors.fiatAmount"
                ><FieldLabel for="fiat-amount">Потрачено рублей</FieldLabel
                ><Input
                  id="fiat-amount"
                  v-model="form.fiatAmount"
                  inputmode="decimal"
                  placeholder="150 000,00"
                  :aria-invalid="!!errors.fiatAmount"
                /><FieldError v-if="errors.fiatAmount">{{ errors.fiatAmount }}</FieldError></Field
              >
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  ><FieldLabel>Полученный актив</FieldLabel
                  ><Select v-model="form.assetIn"
                    ><SelectTrigger aria-label="Полученный актив"><SelectValue /></SelectTrigger
                    ><SelectContent
                      ><SelectGroup
                        ><SelectItem v-for="asset in cryptoAssets" :key="asset.id" :value="asset.id">{{
                          asset.symbol
                        }}</SelectItem></SelectGroup
                      ></SelectContent
                    ></Select
                  ></Field
                >
                <Field :data-invalid="!!errors.amountIn"
                  ><FieldLabel for="amount-in">Получено</FieldLabel
                  ><Input
                    id="amount-in"
                    v-model="form.amountIn"
                    inputmode="decimal"
                    placeholder="1 875,00"
                    :aria-invalid="!!errors.amountIn"
                  /><FieldError v-if="errors.amountIn">{{ errors.amountIn }}</FieldError></Field
                >
              </div>
              <Field :data-invalid="!!errors.locationTo"
                ><FieldLabel>Площадка покупки</FieldLabel
                ><Select v-model="form.locationTo"
                  ><SelectTrigger aria-label="Площадка покупки" :aria-invalid="!!errors.locationTo"><SelectValue /></SelectTrigger
                  ><SelectContent
                    ><SelectGroup
                      ><SelectItem
                        v-for="location in references.locations.filter((item) => item.kind !== 'fiat')"
                        :key="location.id"
                        :value="location.id"
                        >{{ location.name }}</SelectItem
                      ></SelectGroup
                    ></SelectContent
                  ></Select
                ><FieldError v-if="errors.locationTo">{{ errors.locationTo }}</FieldError></Field
              >
            </template>

            <template v-if="type === 'conversion'">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  ><FieldLabel>Отдаю актив</FieldLabel
                  ><Select v-model="form.assetOut"
                    ><SelectTrigger aria-label="Отдаю актив"><SelectValue /></SelectTrigger
                    ><SelectContent
                      ><SelectGroup
                        ><SelectItem v-for="asset in cryptoAssets" :key="asset.id" :value="asset.id">{{
                          asset.symbol
                        }}</SelectItem></SelectGroup
                      ></SelectContent
                    ></Select
                  ></Field
                ><Field :data-invalid="!!errors.amountOut"
                  ><FieldLabel for="amount-out">Количество</FieldLabel
                  ><Input
                    id="amount-out"
                    v-model="form.amountOut"
                    inputmode="decimal"
                    placeholder="1 870,20"
                    :aria-invalid="!!errors.amountOut"
                  /><FieldError v-if="errors.amountOut">{{ errors.amountOut }}</FieldError></Field
                >
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  ><FieldLabel>Получаю актив</FieldLabel
                  ><Select v-model="form.assetIn"
                    ><SelectTrigger aria-label="Получаю актив"><SelectValue /></SelectTrigger
                    ><SelectContent
                      ><SelectGroup
                        ><SelectItem v-for="asset in cryptoAssets" :key="asset.id" :value="asset.id">{{
                          asset.symbol
                        }}</SelectItem></SelectGroup
                      ></SelectContent
                    ></Select
                  ></Field
                ><Field :data-invalid="!!errors.amountIn"
                  ><FieldLabel for="conversion-in">Количество</FieldLabel
                  ><Input
                    id="conversion-in"
                    v-model="form.amountIn"
                    inputmode="decimal"
                    placeholder="1 865,50"
                    :aria-invalid="!!errors.amountIn"
                  /><FieldError v-if="errors.amountIn">{{ errors.amountIn }}</FieldError></Field
                >
              </div>
              <Field :data-invalid="!!errors.locationFrom"
                ><FieldLabel>Площадка</FieldLabel
                ><Select v-model="form.locationFrom"
                  ><SelectTrigger aria-label="Площадка" :aria-invalid="!!errors.locationFrom"><SelectValue /></SelectTrigger
                  ><SelectContent
                    ><SelectGroup
                      ><SelectItem
                        v-for="location in references.locations.filter((item) => item.kind !== 'fiat')"
                        :key="location.id"
                        :value="location.id"
                        >{{ location.name }}</SelectItem
                      ></SelectGroup
                    ></SelectContent
                  ></Select
                ><FieldError v-if="errors.locationFrom">{{ errors.locationFrom }}</FieldError></Field
              >
            </template>

            <template v-if="type === 'transfer'">
              <Field
                ><FieldLabel>Актив</FieldLabel
                ><Select v-model="form.asset"
                  ><SelectTrigger aria-label="Актив"><SelectValue /></SelectTrigger
                  ><SelectContent
                    ><SelectGroup
                      ><SelectItem v-for="item in cryptoAssets" :key="item.id" :value="item.id">{{ item.symbol }}</SelectItem></SelectGroup
                    ></SelectContent
                  ></Select
                ></Field
              >
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field :data-invalid="!!errors.amountSent"
                  ><FieldLabel for="amount-sent">Отправлено</FieldLabel
                  ><Input
                    id="amount-sent"
                    v-model="form.amountSent"
                    inputmode="decimal"
                    placeholder="1 865,50"
                    :aria-invalid="!!errors.amountSent"
                  /><FieldError v-if="errors.amountSent">{{ errors.amountSent }}</FieldError></Field
                ><Field :data-invalid="!!errors.amountReceived"
                  ><FieldLabel for="amount-received">Получено</FieldLabel
                  ><Input
                    id="amount-received"
                    v-model="form.amountReceived"
                    inputmode="decimal"
                    :aria-invalid="!!errors.amountReceived"
                    placeholder="1 865,40"
                  /><FieldError v-if="errors.amountReceived">{{ errors.amountReceived }}</FieldError></Field
                >
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field :data-invalid="!!errors.locationFrom"
                  ><FieldLabel>Откуда</FieldLabel
                  ><Select v-model="form.locationFrom"
                    ><SelectTrigger aria-label="Откуда" :aria-invalid="!!errors.locationFrom"><SelectValue /></SelectTrigger
                    ><SelectContent
                      ><SelectGroup
                        ><SelectItem
                          v-for="location in references.locations.filter((item) => item.kind !== 'fiat')"
                          :key="location.id"
                          :value="location.id"
                          >{{ location.name }}</SelectItem
                        ></SelectGroup
                      ></SelectContent
                    ></Select
                  ><FieldError v-if="errors.locationFrom">{{ errors.locationFrom }}</FieldError></Field
                ><Field :data-invalid="!!errors.locationTo"
                  ><FieldLabel>Куда</FieldLabel
                  ><Select v-model="form.locationTo"
                    ><SelectTrigger aria-label="Куда" :aria-invalid="!!errors.locationTo"><SelectValue /></SelectTrigger
                    ><SelectContent
                      ><SelectGroup
                        ><SelectItem
                          v-for="location in references.locations.filter((item) => item.kind !== 'fiat')"
                          :key="location.id"
                          :value="location.id"
                          >{{ location.name }}</SelectItem
                        ></SelectGroup
                      ></SelectContent
                    ></Select
                  ><FieldError v-if="errors.locationTo">{{ errors.locationTo }}</FieldError></Field
                >
              </div>
              <Field
                ><FieldLabel>Сеть</FieldLabel
                ><Select v-model="form.networkId"
                  ><SelectTrigger aria-label="Сеть"><SelectValue placeholder="Выберите сеть" /></SelectTrigger
                  ><SelectContent
                    ><SelectGroup
                      ><SelectItem v-for="network in references.networks" :key="network.id" :value="network.id">{{
                        network.name
                      }}</SelectItem></SelectGroup
                    ></SelectContent
                  ></Select
                ></Field
              >
              <Field :data-invalid="!!errors.txHash"
                ><FieldLabel for="tx-hash">Tx hash</FieldLabel
                ><Input
                  id="tx-hash"
                  v-model="form.txHash"
                  autocomplete="off"
                  placeholder="Необязательно"
                  :aria-invalid="!!errors.txHash"
                /><FieldError v-if="errors.txHash">{{ errors.txHash }}</FieldError></Field
              >
              <Field>
                <FieldLabel for="destination-address">Адрес назначения</FieldLabel>
                <Input id="destination-address" v-model="form.destinationAddress" autocomplete="off" placeholder="Необязательно" />
              </Field>
            </template>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field :data-invalid="!!errors.feeAmount"
                ><FieldLabel for="fee">Комиссия</FieldLabel
                ><Input
                  id="fee"
                  v-model="form.feeAmount"
                  inputmode="decimal"
                  placeholder="0"
                  :aria-invalid="!!errors.feeAmount"
                /><FieldError v-if="errors.feeAmount">{{ errors.feeAmount }}</FieldError></Field
              >
              <Field
                ><FieldLabel>Актив комиссии</FieldLabel
                ><Select v-model="form.feeAsset"
                  ><SelectTrigger aria-label="Актив комиссии"><SelectValue placeholder="Выберите актив" /></SelectTrigger
                  ><SelectContent
                    ><SelectGroup
                      ><SelectItem v-for="asset in references.assets" :key="asset.id" :value="asset.id">{{
                        asset.symbol
                      }}</SelectItem></SelectGroup
                    ></SelectContent
                  ></Select
                ></Field
              >
            </div>
            <Field
              ><FieldLabel for="external-id">Внешний ID</FieldLabel
              ><Input id="external-id" :disabled="!!operation && operation.source !== 'manual'" v-model="form.externalId" autocomplete="off" placeholder="Необязательно"
            /></Field>
            <Field
              ><FieldLabel for="note">Заметка</FieldLabel
              ><Textarea id="note" v-model="form.note" :rows="3" placeholder="Контекст операции без банковских реквизитов"
            /></Field>
            <FieldError v-if="errors.form">{{ errors.form }}</FieldError>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
    </div>
    <label v-if="requiresReview" class="mx-5 mb-3 flex items-start gap-2 rounded-lg border bg-amber-50 p-3 text-sm">
      <input v-model="confirmed" type="checkbox" :disabled="saving" class="mt-1" />
      <span>Я проверил данные. Подтвердить операцию и включить её в расчёт.</span>
    </label>
    <div class="flex justify-end gap-2 border-t p-5">
      <Button type="button" variant="outline" @click="emit('cancel')">Отмена</Button>
      <Button type="submit" :disabled="saving"
        ><Spinner v-if="saving" data-icon="inline-start" />{{ saving ? 'Сохраняем…' : confirmed ? 'Подтвердить и сохранить' : 'Сохранить' }}</Button
      >
    </div>
  </form>
</template>
