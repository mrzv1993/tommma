import { describe, expect, it } from 'vitest'
import type { Operation } from './contracts.js'
import { calculatePortfolio, divideDecimal, formatDecimal, formatRub } from './domain.js'

const operation = (overrides: Partial<Operation>): Operation => ({
  id: crypto.randomUUID(),
  type: 'purchase',
  occurredAt: '2026-09-03T10:00:00.000Z',
  timezone: 'Asia/Bangkok',
  status: 'completed',
  source: 'manual',
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
  legs: [],
  ...overrides,
})

describe('calculatePortfolio', () => {
  it('preserves namespaced reference IDs without merging positions', () => {
    const result = calculatePortfolio([operation({ legs: [
      { id: '1', direction: 'out', assetId: 'rub', amount: '8000', position: 0 },
      { id: '2', direction: 'in', assetId: 'token:eth', locationId: 'wallet:1', amount: '1', position: 1 },
    ] })])
    expect(result.positions).toEqual([{ assetId: 'token:eth', locationId: 'wallet:1', amount: '1', costRub: '8000', averageCostRub: '8000' }])
  })
  it('calculates purchase cost and moving average', () => {
    const result = calculatePortfolio([
      operation({
        legs: [
          { id: '1', direction: 'out', assetId: 'rub', amount: '150000', fiatValue: '150000', position: 0 },
          { id: '2', direction: 'in', assetId: 'usdt', amount: '1875', locationId: 'okx', position: 1 },
        ],
      }),
      operation({
        occurredAt: '2026-09-04T10:00:00.000Z',
        legs: [
          { id: '3', direction: 'out', assetId: 'rub', amount: '85000', fiatValue: '85000', position: 0 },
          { id: '4', direction: 'in', assetId: 'usdt', amount: '1000', locationId: 'okx', position: 1 },
        ],
      }),
    ])
    expect(result.investedRub).toBe('235000')
    expect(result.positions[0]?.amount).toBe('2875')
    expect(result.positions[0]?.averageCostRub).toBe('81.739130434782608696')
  })

  it('moves cost through conversion and internal transfer without new investment', () => {
    const purchase = operation({
      legs: [
        { id: '1', direction: 'out', assetId: 'rub', amount: '150000', fiatValue: '150000', position: 0 },
        { id: '2', direction: 'in', assetId: 'usdt', amount: '1875', locationId: 'okx', position: 1 },
      ],
    })
    const conversion = operation({
      type: 'conversion',
      occurredAt: '2026-09-03T11:00:00.000Z',
      locationFromId: 'okx',
      locationToId: 'okx',
      legs: [
        { id: '3', direction: 'out', assetId: 'usdt', amount: '1870.2', locationId: 'okx', position: 0 },
        { id: '4', direction: 'in', assetId: 'usdc', amount: '1865.5', locationId: 'okx', position: 1 },
      ],
    })
    const transfer = operation({
      type: 'transfer',
      occurredAt: '2026-09-03T12:00:00.000Z',
      locationFromId: 'okx',
      locationToId: 'okx-wallet',
      legs: [
        { id: '5', direction: 'out', assetId: 'usdc', amount: '1865.5', locationId: 'okx', position: 0 },
        { id: '6', direction: 'in', assetId: 'usdc', amount: '1865.4', locationId: 'okx-wallet', position: 1 },
      ],
    })
    const result = calculatePortfolio([purchase, conversion, transfer])
    expect(result.investedRub).toBe('150000')
    expect(result.positions.find((position) => position.locationId === 'okx-wallet')?.amount).toBe('1865.4')
    expect(Number(result.feesRub)).toBeGreaterThan(0)
  })

  it('ignores pending and archived operations', () => {
    expect(
      calculatePortfolio([operation({ status: 'pending' }), operation({ archivedAt: '2026-09-03T12:00:00.000Z' })]).positions,
    ).toHaveLength(0)
  })

  it('recalculates later balances when an old purchase is archived', () => {
    const oldPurchase = operation({
      archivedAt: '2026-09-05T10:00:00.000Z',
      legs: [
        { id: '1', direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000', position: 0 },
        { id: '2', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 },
      ],
    })
    const activePurchase = operation({
      occurredAt: '2026-09-04T10:00:00.000Z',
      legs: [
        { id: '3', direction: 'out', assetId: 'rub', amount: '9000', fiatValue: '9000', position: 0 },
        { id: '4', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 },
      ],
    })
    const result = calculatePortfolio([oldPurchase, activePurchase])
    expect(result.investedRub).toBe('9000')
    expect(result.positions[0]).toMatchObject({ amount: '100', costRub: '9000', averageCostRub: '90' })
  })

  it('charges a third-asset conversion fee to the received cost basis', () => {
    const result = calculatePortfolio([
      operation({
        legs: [
          { id: '1', direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000', position: 0 },
          { id: '2', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 },
        ],
      }),
      operation({
        occurredAt: '2026-09-03T10:30:00.000Z',
        legs: [
          { id: '3', direction: 'out', assetId: 'rub', amount: '100000', fiatValue: '100000', position: 0 },
          { id: '4', direction: 'in', assetId: 'eth', amount: '1', locationId: 'okx', position: 1 },
        ],
      }),
      operation({
        type: 'conversion',
        occurredAt: '2026-09-03T11:00:00.000Z',
        locationFromId: 'okx',
        locationToId: 'okx',
        legs: [
          { id: '5', direction: 'out', assetId: 'usdt', amount: '50', locationId: 'okx', position: 0 },
          { id: '6', direction: 'in', assetId: 'usdc', amount: '50', locationId: 'okx', position: 1 },
          { id: '7', direction: 'fee', assetId: 'eth', amount: '0.1', locationId: 'okx', position: 2 },
        ],
      }),
    ])
    expect(result.feesRub).toBe('10000')
    expect(result.positions.find((position) => position.assetId === 'usdc')?.costRub).toBe('14000')
    expect(result.positions.find((position) => position.assetId === 'eth')?.amount).toBe('0.9')
  })

  it('does not charge a same-asset transfer fee twice when it is already withheld', () => {
    const result = calculatePortfolio([
      operation({
        legs: [
          { id: '1', direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000', position: 0 },
          { id: '2', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 },
        ],
      }),
      operation({
        type: 'transfer',
        occurredAt: '2026-09-03T11:00:00.000Z',
        locationFromId: 'okx',
        locationToId: 'okx-wallet',
        legs: [
          { id: '3', direction: 'out', assetId: 'usdt', amount: '99', locationId: 'okx', position: 0 },
          { id: '4', direction: 'in', assetId: 'usdt', amount: '98', locationId: 'okx-wallet', position: 1 },
          { id: '5', direction: 'fee', assetId: 'usdt', amount: '1', locationId: 'okx', position: 2 },
        ],
      }),
    ])
    expect(result.feesRub).toBe('80')
    expect(result.positions.find((position) => position.locationId === 'okx')?.amount).toBe('1')
    expect(result.positions.find((position) => position.locationId === 'okx-wallet')?.costRub).toBe('7840')
  })

  it('deducts a purchase fee paid from the acquired asset', () => {
    const result = calculatePortfolio([
      operation({
        legs: [
          { id: '1', direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000', position: 0 },
          { id: '2', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 },
          { id: '3', direction: 'fee', assetId: 'usdt', amount: '1', locationId: 'okx', position: 2 },
        ],
      }),
    ])
    expect(result.positions[0]).toMatchObject({ amount: '99', costRub: '7920', averageCostRub: '80' })
    expect(result.feesRub).toBe('80')
  })

  it('deducts a conversion fee paid from the gross received asset', () => {
    const result = calculatePortfolio([
      operation({
        legs: [
          { id: '1', direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000', position: 0 },
          { id: '2', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 },
        ],
      }),
      operation({
        type: 'conversion',
        occurredAt: '2026-09-03T11:00:00.000Z',
        locationFromId: 'okx',
        locationToId: 'okx',
        legs: [
          { id: '3', direction: 'out', assetId: 'usdt', amount: '100', locationId: 'okx', position: 0 },
          { id: '4', direction: 'in', assetId: 'usdc', amount: '100', locationId: 'okx', position: 1 },
          { id: '5', direction: 'fee', assetId: 'usdc', amount: '1', locationId: 'okx', position: 2 },
        ],
      }),
    ])
    expect(result.positions[0]).toMatchObject({ assetId: 'usdc', amount: '99', costRub: '7920', averageCostRub: '80' })
    expect(result.feesRub).toBe('80')
  })
})

describe('decimal presentation', () => {
  it('formats values without converting them to JavaScript Number', () => {
    expect(formatDecimal('9007199254740992.123456789')).toBe('9 007 199 254 740 992,12345679')
    expect(formatRub('150000')).toBe('150 000,00 ₽')
    expect(divideDecimal('1', '3')).toBe('0.33333333333333333333')
  })
})
