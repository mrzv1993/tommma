import { withCapitalOwner } from './connections.js'
import { afterEach, describe, expect, it as test, vi } from 'vitest'
import { fetchOkxHistory, mapOkxRecord, okxConnectionStatus, okxGet } from './okx.js'

const it = (name: string, run: () => unknown) => test(name, () => { process.env.CAPITAL_OKX_OWNER_USER_ID = '1'; return withCapitalOwner(1n, run) })

const originalEnvironment = { ...process.env }
afterEach(() => {
  process.env = { ...originalEnvironment }
  vi.restoreAllMocks()
})

describe('mapOkxRecord', () => {
  it('maps a deposit to a reviewable transfer into OKX', () => {
    const result = mapOkxRecord('deposits', {
      depId: 'dep-1',
      ccy: 'USDT',
      amt: '25.5',
      chain: 'USDT-TRC20',
      state: '2',
      ts: '1700000000000',
      txId: 'tx-1',
    })
    expect(result).toMatchObject({
      type: 'transfer',
      status: 'needs_review',
      externalId: 'deposits:dep-1',
      locationFromId: 'external-wallet',
      locationToId: 'okx',
      networkId: 'tron',
    })
    expect(result?.legs).toHaveLength(2)
  })

  it('maps a spot buy without using floating point arithmetic', () => {
    const result = mapOkxRecord('fills', {
      tradeId: 'trade-1',
      instId: 'BTC-USDT',
      side: 'buy',
      fillSz: '0.00000001',
      fillPx: '100000',
      fee: '-0.000000001',
      feeCcy: 'BTC',
      fillTime: '1700000000000',
    })
    expect(result?.legs).toEqual([
      { direction: 'out', assetId: 'usdt', amount: '0.001', locationId: 'okx' },
      { direction: 'in', assetId: 'btc', amount: '0.00000001', locationId: 'okx' },
      { direction: 'fee', assetId: 'btc', amount: '0.000000001', locationId: 'okx' },
    ])
  })

  it('does not map balance bills as duplicate operations', () => {
    expect(mapOkxRecord('bills', { billId: 'bill-1', ts: '1700000000000' })).toBeNull()
  })

  it('maps an OKX Convert sale', () => {
    const result = mapOkxRecord('converts', {
      tradeId: 'convert-1',
      side: 'sell',
      baseCcy: 'ETH',
      quoteCcy: 'USDT',
      fillBaseSz: '0.1',
      fillQuoteSz: '300',
      ts: '1700000000000',
    })
    expect(result).toMatchObject({ type: 'conversion', externalId: 'converts:convert-1', status: 'needs_review' })
    expect(result?.legs).toEqual([
      { direction: 'out', assetId: 'eth', amount: '0.1', locationId: 'okx' },
      { direction: 'in', assetId: 'usdt', amount: '300', locationId: 'okx' },
    ])
  })

  it('ignores malformed external amounts without breaking the sync', () => {
    expect(mapOkxRecord('withdrawals', { wdId: 'bad-1', ccy: 'USDT', amt: 'not-a-number', ts: '1700000000000' })).toBeNull()
  })

  it('retains confirmed pages when a later OKX page fails', async () => {
    process.env.OKX_API_KEY = 'read-only-key'
    process.env.OKX_API_SECRET = 'test-secret'
    process.env.OKX_PASSPHRASE = 'test-passphrase'
    process.env.OKX_RETRY_BASE_MS = '0'
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ depId: `dep-${index}`, ts: String(100 - index) }))
    const progress: number[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/deposit-history') && !url.includes('after=')) {
        return new Response(JSON.stringify({ code: '0', msg: '', data: firstPage }), { status: 200 })
      }
      if (url.includes('/deposit-history') && url.includes('after=')) return new Response('', { status: 500 })
      return new Response(JSON.stringify({ code: '0', msg: '', data: [] }), { status: 200 })
    })

    const result = await fetchOkxHistory((event) => progress.push(event.fetched))

    expect(result.history.deposits).toHaveLength(100)
    expect(result.errors).toEqual(['deposits: OKX_HTTP_500'])
    expect(progress).toContain(100)
  })

  it('retries a transient OKX rate-limit response', async () => {
    process.env.OKX_API_KEY = 'read-only-key'
    process.env.OKX_API_SECRET = 'test-secret'
    process.env.OKX_PASSPHRASE = 'test-passphrase'
    process.env.OKX_RETRY_BASE_MS = '0'
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: '0', msg: '', data: [{ ccy: 'USDT' }] }), { status: 200 }))

    await expect(okxGet<Array<{ ccy: string }>>('/api/v5/account/test')).resolves.toEqual([{ ccy: 'USDT' }])
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('exposes only a masked API key status', () => {
    process.env.OKX_API_KEY = 'sensitive-read-only-key'
    process.env.OKX_API_SECRET = 'test-secret'
    process.env.OKX_PASSPHRASE = 'test-passphrase'
    expect(okxConnectionStatus()).toEqual({ configured: true, maskedApiKey: '••••-key' })
    expect(JSON.stringify(okxConnectionStatus())).not.toContain('sensitive-read-only-key')
  })

  it('stops an incremental source when it reaches the saved high-water record', async () => {
    process.env.OKX_API_KEY = 'read-only-key'
    process.env.OKX_API_SECRET = 'test-secret'
    process.env.OKX_PASSPHRASE = 'test-passphrase'
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const data = url.includes('/deposit-history')
        ? [
            { depId: 'new', ts: '3' },
            { depId: 'known', ts: '2' },
            { depId: 'old', ts: '1' },
          ]
        : []
      return new Response(JSON.stringify({ code: '0', msg: '', data }), { status: 200 })
    })

    const result = await fetchOkxHistory(undefined, { deposits: 'deposits:known' })

    expect(result.history.deposits).toEqual([{ depId: 'new', ts: '3' }])
    expect(result.cursors.deposits).toBe('deposits:new')
    expect(request.mock.calls.filter(([url]) => String(url).includes('/deposit-history'))).toHaveLength(1)
  })
})
