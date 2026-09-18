import { Decimal } from 'decimal.js'
import type { Operation } from './contracts.js'

export interface Position {
  assetId: string
  locationId: string
  amount: string
  costRub: string
  averageCostRub: string
}

export interface PortfolioResult {
  positions: Position[]
  investedRub: string
  feesRub: string
}

type MutablePosition = { amount: Decimal; costRub: Decimal }

const keyOf = (assetId: string, locationId?: string | null) => JSON.stringify([assetId, locationId || 'unknown'])

export function calculatePortfolio(operations: Operation[]): PortfolioResult {
  const positions = new Map<string, MutablePosition>()
  let investedRub = new Decimal(0)
  let feesRub = new Decimal(0)

  const get = (assetId: string, locationId?: string | null) => {
    const key = keyOf(assetId, locationId)
    const current = positions.get(key) ?? { amount: new Decimal(0), costRub: new Decimal(0) }
    positions.set(key, current)
    return current
  }

  const remove = (assetId: string, locationId: string | undefined | null, amount: Decimal) => {
    const position = get(assetId, locationId)
    const average = position.amount.gt(0) ? position.costRub.div(position.amount) : new Decimal(0)
    const removedCost = Decimal.min(position.costRub, average.mul(amount))
    position.amount = Decimal.max(0, position.amount.minus(amount))
    position.costRub = Decimal.max(0, position.costRub.minus(removedCost))
    return removedCost
  }

  const sorted = [...operations]
    .filter((operation) => operation.status === 'completed' && !operation.archivedAt)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt.localeCompare(b.createdAt))

  for (const operation of sorted) {
    const incoming = operation.legs.filter((leg) => leg.direction === 'in')
    const outgoing = operation.legs.filter((leg) => leg.direction === 'out')
    const feeLegs = operation.legs.filter((leg) => leg.direction === 'fee')

    if (operation.type === 'purchase') {
      const fiatSpent = outgoing.reduce((sum, leg) => sum.plus(leg.fiatValue || leg.amount), new Decimal(0))
      const fiatValuedFees = feeLegs.reduce(
        (sum, leg) => sum.plus(leg.fiatValue || (leg.assetId === 'rub' ? leg.amount : 0)),
        new Decimal(0),
      )
      const acquiredCost = fiatSpent.plus(fiatValuedFees)
      investedRub = investedRub.plus(fiatSpent).plus(fiatValuedFees)
      feesRub = feesRub.plus(fiatValuedFees)
      for (const leg of incoming) {
        const position = get(leg.assetId, leg.locationId || operation.locationToId)
        position.amount = position.amount.plus(leg.amount)
        position.costRub = position.costRub.plus(acquiredCost)
      }
      for (const leg of feeLegs.filter((fee) => fee.assetId !== 'rub')) {
        const cost = remove(leg.assetId, leg.locationId || operation.locationToId, new Decimal(leg.amount))
        if (!leg.fiatValue) feesRub = feesRub.plus(cost)
      }
      continue
    }

    if (operation.type === 'conversion') {
      const removedCost = outgoing.reduce(
        (sum, leg) => sum.plus(remove(leg.assetId, leg.locationId || operation.locationFromId, new Decimal(leg.amount))),
        new Decimal(0),
      )
      const incomingAssets = new Set(incoming.map((leg) => leg.assetId))
      let feeCost = new Decimal(0)
      for (const leg of feeLegs.filter((fee) => !incomingAssets.has(fee.assetId))) {
        const cost = leg.fiatValue
          ? new Decimal(leg.fiatValue)
          : remove(leg.assetId, leg.locationId || operation.locationFromId, new Decimal(leg.amount))
        feeCost = feeCost.plus(cost)
      }
      feesRub = feesRub.plus(feeCost)
      for (const leg of incoming) {
        const position = get(leg.assetId, leg.locationId || operation.locationToId || operation.locationFromId)
        position.amount = position.amount.plus(leg.amount)
        position.costRub = position.costRub.plus(removedCost).plus(feeCost)
      }
      for (const leg of feeLegs.filter((fee) => incomingAssets.has(fee.assetId))) {
        const cost = remove(leg.assetId, leg.locationId || operation.locationToId || operation.locationFromId, new Decimal(leg.amount))
        feesRub = feesRub.plus(leg.fiatValue ? new Decimal(leg.fiatValue) : cost)
      }
      continue
    }

    if (operation.type === 'transfer') {
      const sentCost = outgoing.reduce(
        (sum, leg) => sum.plus(remove(leg.assetId, leg.locationId || operation.locationFromId, new Decimal(leg.amount))),
        new Decimal(0),
      )
      const totalSent = outgoing.reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0))
      const totalReceived = incoming.reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0))
      const movedRatio = totalSent.gt(0) ? Decimal.min(1, totalReceived.div(totalSent)) : new Decimal(0)
      const movedCost = sentCost.mul(movedRatio)
      const implicitFeeCost = sentCost.minus(movedCost)
      feesRub = feesRub.plus(implicitFeeCost)
      for (const leg of incoming) {
        const share = totalReceived.gt(0) ? new Decimal(leg.amount).div(totalReceived) : new Decimal(0)
        const position = get(leg.assetId, leg.locationId || operation.locationToId)
        position.amount = position.amount.plus(leg.amount)
        position.costRub = position.costRub.plus(movedCost.mul(share))
      }
      const transferAsset = outgoing[0]?.assetId
      const implicitFeeAmount = totalSent.gt(totalReceived) ? totalSent.minus(totalReceived) : new Decimal(0)
      const sameAssetFeeAmount = feeLegs
        .filter((leg) => leg.assetId === transferAsset)
        .reduce((sum, leg) => sum.plus(leg.amount), new Decimal(0))
      const additionalSameAssetFee = Decimal.max(0, sameAssetFeeAmount.minus(implicitFeeAmount))
      if (transferAsset && additionalSameAssetFee.gt(0)) {
        feesRub = feesRub.plus(remove(transferAsset, operation.locationFromId, additionalSameAssetFee))
      }
      for (const leg of feeLegs.filter((fee) => fee.assetId !== transferAsset)) {
        const cost = leg.fiatValue
          ? new Decimal(leg.fiatValue)
          : remove(leg.assetId, leg.locationId || operation.locationFromId, new Decimal(leg.amount))
        feesRub = feesRub.plus(cost)
      }
    }
  }

  return {
    positions: [...positions.entries()]
      .filter(([, value]) => value.amount.gt(0))
      .map(([key, value]) => {
        const [assetId, locationId] = JSON.parse(key) as [string, string]
        return {
          assetId,
          locationId,
          amount: value.amount.toFixed(),
          costRub: value.costRub.toFixed(),
          averageCostRub: value.amount.gt(0) ? value.costRub.div(value.amount).toFixed() : '0',
        }
      }),
    investedRub: investedRub.toFixed(),
    feesRub: feesRub.toFixed(),
  }
}

export function normalizeDecimal(value: string): string {
  return new Decimal(value.replace(',', '.')).toFixed()
}

export function divideDecimal(dividend: string, divisor: string): string | null {
  const right = new Decimal(divisor)
  if (right.isZero()) return null
  return new Decimal(dividend).div(right).toFixed()
}

export function formatDecimal(value: string, maximumFractionDigits = 8, minimumFractionDigits = 0): string {
  const rounded = new Decimal(value).toDecimalPlaces(maximumFractionDigits, Decimal.ROUND_HALF_UP).toFixed()
  const negative = rounded.startsWith('-')
  const [integerPart, fractionPart = ''] = (negative ? rounded.slice(1) : rounded).split('.')
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
  const trimmed = fractionPart.replace(/0+$/, '')
  const fraction = trimmed.padEnd(Math.min(minimumFractionDigits, maximumFractionDigits), '0')
  return `${negative ? '−' : ''}${grouped}${fraction ? `,${fraction}` : ''}`
}

export function formatRub(value: string): string {
  return `${formatDecimal(value, 2, 2)}\u00a0₽`
}
