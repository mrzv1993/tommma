import { z } from 'zod'

export const operationTypes = ['purchase', 'conversion', 'transfer'] as const
export const operationStatuses = ['draft', 'pending', 'completed', 'failed', 'needs_review', 'archived'] as const
export const operationSources = ['manual', 'okx_exchange', 'okx_wallet', 'csv'] as const
export const legDirections = ['in', 'out', 'fee'] as const
export const operationSorts = ['newest', 'oldest'] as const

export type OperationType = (typeof operationTypes)[number]
export type OperationStatus = (typeof operationStatuses)[number]
export type OperationSource = (typeof operationSources)[number]
export type LegDirection = (typeof legDirections)[number]
export type OperationSort = (typeof operationSorts)[number]

function compareDecimalStrings(left: string, right: string): number {
  const [leftInteger, leftFraction = ''] = left.split('.')
  const [rightInteger, rightFraction = ''] = right.split('.')
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const leftValue = BigInt(`${leftInteger}${leftFraction.padEnd(scale, '0')}`)
  const rightValue = BigInt(`${rightInteger}${rightFraction.padEnd(scale, '0')}`)
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
}

const decimal = z
  .string()
  .trim()
  .transform((value) => value.replace(',', '.'))
  .pipe(
    z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Введите положительное число')
      .refine((value) => /[1-9]/.test(value), 'Значение должно быть больше нуля')
      .refine((value) => value.replace('.', '').length <= 38, 'Не более 38 значащих цифр'),
  )

const optionalDecimal = z
  .string()
  .trim()
  .transform((value) => value.replace(',', '.'))
  .pipe(
    z
      .string()
      .regex(/^\d*(\.\d+)?$/, 'Введите корректное число')
      .refine((value) => value.replace('.', '').length <= 38, 'Не более 38 значащих цифр'),
  )
  .optional()

export const operationLegInputSchema = z.object({
  direction: z.enum(legDirections),
  assetId: z.string().min(1),
  amount: decimal,
  fiatValue: optionalDecimal,
  unitPrice: optionalDecimal,
  locationId: z.string().optional(),
})

export const operationInputSchema = z
  .object({
    type: z.enum(operationTypes),
    occurredAt: z.iso.datetime({ local: true }),
    timezone: z.string().min(1).default('Asia/Bangkok'),
    status: z.enum(operationStatuses).default('completed'),
    source: z.enum(operationSources).default('manual'),
    externalId: z.string().trim().max(200).optional(),
    externalRevision: z.string().trim().max(128).optional(),
    locationFromId: z.string().optional(),
    locationToId: z.string().optional(),
    networkId: z.string().optional(),
    txHash: z.string().trim().max(200).optional(),
    logIndex: z.number().int().nonnegative().optional(),
    destinationAddress: z.string().trim().max(500).optional(),
    note: z.string().trim().max(1000).optional(),
    legs: z.array(operationLegInputSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const incoming = value.legs.filter((leg) => leg.direction === 'in')
    const outgoing = value.legs.filter((leg) => leg.direction === 'out')
    if (!incoming.length || !outgoing.length)
      ctx.addIssue({ code: 'custom', path: ['legs'], message: 'Нужны входящая и исходящая проводки' })
    if (incoming.length > 1 || outgoing.length > 1)
      ctx.addIssue({ code: 'custom', path: ['legs'], message: 'Для операции нужна одна входящая и одна исходящая проводка' })
    if (value.type === 'purchase' && !value.locationToId)
      ctx.addIssue({ code: 'custom', path: ['locationToId'], message: 'Выберите площадку покупки' })
    if (value.type === 'conversion' && incoming[0]?.assetId === outgoing[0]?.assetId)
      ctx.addIssue({ code: 'custom', path: ['legs'], message: 'Активы конвертации должны различаться' })
    if (value.type === 'conversion' && !value.locationFromId)
      ctx.addIssue({ code: 'custom', path: ['locationFromId'], message: 'Выберите площадку конвертации' })
    if (value.type === 'transfer') {
      if (!value.locationFromId) ctx.addIssue({ code: 'custom', path: ['locationFromId'], message: 'Выберите источник перевода' })
      if (!value.locationToId) ctx.addIssue({ code: 'custom', path: ['locationToId'], message: 'Выберите назначение перевода' })
      if (value.locationFromId && value.locationFromId === value.locationToId)
        ctx.addIssue({ code: 'custom', path: ['locationToId'], message: 'Источник и назначение должны различаться' })
    }
    if (value.type === 'transfer' && incoming[0] && outgoing[0]) {
      if (incoming[0].assetId !== outgoing[0].assetId)
        ctx.addIssue({ code: 'custom', path: ['legs'], message: 'Актив перевода должен совпадать в обеих проводках' })
      if (compareDecimalStrings(incoming[0].amount, outgoing[0].amount) > 0)
        ctx.addIssue({ code: 'custom', path: ['legs', 1, 'amount'], message: 'Получено не может быть больше отправленного' })
    }
  })

export type OperationInput = z.input<typeof operationInputSchema>
export type NormalizedOperationInput = z.output<typeof operationInputSchema>

export interface Asset {
  id: string
  symbol: string
  name: string
  kind: 'crypto' | 'fiat'
  decimals: number
}
export interface Location {
  id: string
  name: string
  kind: 'exchange' | 'wallet' | 'fiat'
}
export interface Network {
  id: string
  name: string
  code: string
}
export interface OperationLeg extends Omit<NormalizedOperationInput['legs'][number], 'fiatValue' | 'unitPrice'> {
  id: string
  fiatValue?: string | null
  unitPrice?: string | null
  position: number
}
export interface Operation extends Omit<NormalizedOperationInput, 'legs'> {
  id: string
  createdAt: string
  updatedAt: string
  archivedAt?: string | null
  legs: OperationLeg[]
}
export interface ReferenceData {
  assets: Asset[]
  locations: Location[]
  networks: Network[]
}
export interface OperationFilters {
  search?: string
  type?: OperationType
  assetId?: string
  status?: OperationStatus
  locationId?: string
  networkId?: string
  source?: OperationSource
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: 20 | 50 | 100
  sort?: OperationSort
}
export interface OperationPage {
  items: Operation[]
  total: number
  page: number
  pageSize: number
  lastSyncAt?: string | null
}

export function validateOperationReferences(input: NormalizedOperationInput, references: ReferenceData): string[] {
  const assetById = new Map(references.assets.map((asset) => [asset.id, asset]))
  const locationIds = new Set(references.locations.map((location) => location.id))
  const networkIds = new Set(references.networks.map((network) => network.id))
  const issues = validateAssetPrecisions(input, references.assets)
  const incoming = input.legs.find((leg) => leg.direction === 'in')
  const outgoing = input.legs.find((leg) => leg.direction === 'out')

  for (const locationId of [input.locationFromId, input.locationToId, ...input.legs.map((leg) => leg.locationId)]) {
    if (locationId && !locationIds.has(locationId)) issues.push(`Неизвестная локация: ${locationId}`)
  }
  if (input.networkId && !networkIds.has(input.networkId)) issues.push(`Неизвестная сеть: ${input.networkId}`)
  if (input.txHash && !input.networkId) issues.push('Для tx hash выберите сеть')

  if (input.type === 'purchase') {
    if (outgoing && assetById.get(outgoing.assetId)?.kind !== 'fiat') issues.push('Покупка должна списывать фиатную валюту')
    if (incoming && assetById.get(incoming.assetId)?.kind !== 'crypto') issues.push('Покупка должна зачислять криптоактив')
  } else {
    if (outgoing && assetById.get(outgoing.assetId)?.kind !== 'crypto') issues.push('Исходящий актив должен быть криптовалютой')
    if (incoming && assetById.get(incoming.assetId)?.kind !== 'crypto') issues.push('Входящий актив должен быть криптовалютой')
  }

  return [...new Set(issues)]
}

export function validateAssetPrecisions(input: NormalizedOperationInput, assetList: Asset[]): string[] {
  const precisionByAsset = new Map(assetList.map((asset) => [asset.id, asset.decimals]))
  return input.legs.flatMap((leg) => {
    const precision = precisionByAsset.get(leg.assetId)
    if (precision === undefined) return [`Неизвестный актив: ${leg.assetId}`]
    const fractional = leg.amount.split('.')[1]?.length ?? 0
    return fractional > precision ? [`${leg.assetId.toUpperCase()}: максимум ${precision} знаков после запятой`] : []
  })
}

export function validateTxHash(txHash: string | undefined, network: Network | undefined): string | null {
  if (!txHash || !network) return null
  const patterns: Record<string, RegExp> = {
    ERC20: /^0x[a-fA-F0-9]{64}$/,
    ARBITRUM: /^0x[a-fA-F0-9]{64}$/,
    TRC20: /^[a-fA-F0-9]{64}$/,
    BTC: /^[a-fA-F0-9]{64}$/,
  }
  const pattern = patterns[network.code]
  return pattern && !pattern.test(txHash) ? `Tx hash не соответствует сети ${network.name}` : null
}
