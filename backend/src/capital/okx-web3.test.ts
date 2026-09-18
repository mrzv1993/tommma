import { withCapitalOwner } from './connections.js'
import { afterEach, describe, expect, it as test, vi } from 'vitest'
import {
  fetchOkxWeb3History,
  isSuspiciousOkxWeb3Token,
  mapOkxWeb3Record,
  okxWeb3ConnectionStatus,
  okxWeb3ExternalId,
  okxWeb3Get,
} from './okx-web3.js'

const it = (name: string, run: () => unknown) => test(name, () => { process.env.CAPITAL_OKX_OWNER_USER_ID = '1'; return withCapitalOwner(1n, run) })

const originalEnvironment = { ...process.env }
const wallet = '0x1234567890abcdef1234567890abcdef12345678'

function configure() {
  process.env.OKX_WEB3_API_KEY = 'web3-read-only-key'
  process.env.OKX_WEB3_API_SECRET = 'test-secret'
  process.env.OKX_WEB3_PASSPHRASE = 'test-passphrase'
  process.env.OKX_WALLET_ADDRESS = wallet
  process.env.OKX_WEB3_CHAIN_IDS = '1'
  process.env.OKX_WEB3_RETRY_BASE_MS = '0'
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    chainIndex: '1',
    txHash: `0x${'a'.repeat(64)}`,
    itype: '2',
    txTime: '1700000000000',
    from: [{ address: '0x1111111111111111111111111111111111111111', amount: '25.5' }],
    to: [{ address: wallet, amount: '25.5' }],
    tokenContractAddress: '0x2222222222222222222222222222222222222222',
    amount: '25.5',
    symbol: 'USDT',
    txFee: '0.0001',
    txStatus: 'success',
    hitBlacklist: false,
    ...overrides,
  }
}

afterEach(() => {
  process.env = { ...originalEnvironment }
  vi.restoreAllMocks()
})

describe('OKX Wallet read-only import', () => {
  it('maps an incoming token movement to a reviewable wallet transfer', () => {
    const result = mapOkxWeb3Record(transaction(), wallet)

    expect(result).toMatchObject({
      type: 'transfer',
      status: 'needs_review',
      source: 'okx_wallet',
      locationFromId: 'external-wallet',
      locationToId: 'okx-wallet',
      networkId: 'ethereum',
    })
    expect(result?.legs).toEqual([
      { direction: 'out', assetId: 'usdt', amount: '25.5', locationId: 'external-wallet' },
      { direction: 'in', assetId: 'usdt', amount: '25.5', locationId: 'okx-wallet' },
    ])
  })

  it('uses the chain native asset for an outgoing transaction fee', () => {
    const result = mapOkxWeb3Record(
      transaction({
        from: [{ address: wallet, amount: '25.5' }],
        to: [{ address: '0x3333333333333333333333333333333333333333', amount: '25.5' }],
      }),
      wallet,
    )

    expect(result?.locationFromId).toBe('okx-wallet')
    expect(result?.legs.at(-1)).toEqual({ direction: 'fee', assetId: 'eth', amount: '0.0001', locationId: 'okx-wallet' })
  })

  it('rejects failed, blacklisted and URL-like spam token records', () => {
    const spam = transaction({ symbol: 'opti-line.top ✅' })
    expect(isSuspiciousOkxWeb3Token(spam)).toBe(true)
    expect(mapOkxWeb3Record(spam, wallet)).toBeNull()
    expect(mapOkxWeb3Record(transaction({ hitBlacklist: true }), wallet)).toBeNull()
    expect(mapOkxWeb3Record(transaction({ txStatus: 'failed' }), wallet)).toBeNull()
  })

  it('does not map self-transfers with ambiguous direction', () => {
    expect(
      mapOkxWeb3Record(
        transaction({
          from: [{ address: wallet, amount: '1' }],
          to: [{ address: wallet, amount: '1' }],
        }),
        wallet,
      ),
    ).toBeNull()
  })

  it('creates stable distinct external ids for token movements in the same transaction', () => {
    const first = okxWeb3ExternalId(transaction())
    const second = okxWeb3ExternalId(transaction({ symbol: 'ETH', tokenContractAddress: '' }))
    expect(first).toBe(okxWeb3ExternalId(transaction()))
    expect(first).not.toBe(second)
  })

  it('stops incremental pagination at the saved high-water record', async () => {
    configure()
    const known = transaction({ amount: '2' })
    const newer = transaction({ amount: '3' })
    const older = transaction({ amount: '1' })
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ code: '0', msg: '', data: [{ cursor: '', transactions: [newer, known, older] }] }), { status: 200 }),
      )

    const result = await fetchOkxWeb3History(undefined, { '1': okxWeb3ExternalId(known) })

    expect(result.history['1']).toEqual([newer])
    expect(result.cursors['1']).toBe(okxWeb3ExternalId(newer))
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains a completed page if a later wallet page fails', async () => {
    configure()
    process.env.OKX_WEB3_MAX_PAGES = '2'
    const firstPage = Array.from({ length: 100 }, (_, index) => transaction({ amount: String(index + 1) }))
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '0', msg: '', data: [{ cursor: 'next-page', transactions: firstPage }] }), { status: 200 }),
      )
      .mockResolvedValue(new Response('', { status: 500 }))

    const result = await fetchOkxWeb3History()

    expect(result.history['1']).toHaveLength(100)
    expect(result.errors).toEqual(['1: OKX_WEB3_HTTP_500'])
  })

  it('retries transient rate limits and signs only a GET request', async () => {
    configure()
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: '0', msg: '', data: [{ cursor: '', transactions: [] }] }), { status: 200 }),
      )

    await expect(okxWeb3Get('/api/v6/dex/test')).resolves.toEqual([{ cursor: '', transactions: [] }])
    expect(request).toHaveBeenCalledTimes(2)
    const [, init] = request.mock.calls[1]!
    expect(init?.method).toBeUndefined()
    expect(init?.headers).not.toHaveProperty('Content-Type')
  })

  it('exposes only a masked wallet address', () => {
    configure()
    expect(okxWeb3ConnectionStatus()).toEqual({ configured: true, maskedAddress: '0x1234…5678' })
    expect(JSON.stringify(okxWeb3ConnectionStatus())).not.toContain(wallet)
    expect(JSON.stringify(okxWeb3ConnectionStatus())).not.toContain('web3-read-only-key')
  })
})
