import { describe, expect, it } from 'vitest'
import { operationInputSchema, validateAssetPrecisions, validateTxHash } from './contracts.js'

describe('operation contracts', () => {
  it('normalizes decimal commas', () => {
    const result = operationInputSchema.parse({
      type: 'transfer',
      occurredAt: '2026-09-03T10:00:00.000Z',
      timezone: 'UTC',
      locationFromId: 'okx',
      locationToId: 'wallet',
      legs: [
        { direction: 'out', assetId: 'usdt', amount: '1,25' },
        { direction: 'in', assetId: 'usdt', amount: '1,25' },
      ],
    })
    expect(result.legs[0]?.amount).toBe('1.25')
  })

  it('rejects amounts exceeding asset precision', () => {
    const input = operationInputSchema.parse({
      type: 'transfer',
      occurredAt: '2026-09-03T10:00:00.000Z',
      timezone: 'UTC',
      locationFromId: 'okx',
      locationToId: 'wallet',
      legs: [
        { direction: 'out', assetId: 'usdt', amount: '1.0000001' },
        { direction: 'in', assetId: 'usdt', amount: '1' },
      ],
    })
    expect(validateAssetPrecisions(input, [{ id: 'usdt', symbol: 'USDT', name: 'Tether', kind: 'crypto', decimals: 6 }])).toEqual([
      'USDT: максимум 6 знаков после запятой',
    ])
  })

  it('validates a transaction hash against the selected network', () => {
    const ethereum = { id: 'ethereum', name: 'Ethereum', code: 'ERC20' }
    expect(validateTxHash(`0x${'a'.repeat(64)}`, ethereum)).toBeNull()
    expect(validateTxHash('abc', ethereum)).toBe('Tx hash не соответствует сети Ethereum')
  })

  it('compares transfer amounts without floating-point coercion', () => {
    const result = operationInputSchema.safeParse({
      type: 'transfer',
      occurredAt: '2026-09-03T10:00:00.000Z',
      timezone: 'UTC',
      locationFromId: 'okx',
      locationToId: 'wallet',
      legs: [
        { direction: 'out', assetId: 'usdt', amount: '9007199254740992.000000000000000001' },
        { direction: 'in', assetId: 'usdt', amount: '9007199254740992.000000000000000002' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('больше отправленного'))).toBe(true)
  })
})
