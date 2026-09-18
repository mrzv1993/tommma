import { capitalConnection } from './connections.js'
import { createHash, createHmac } from 'node:crypto'
import { Decimal } from 'decimal.js'
import type { NormalizedOperationInput } from './shared/contracts.js'
import { okxAssetId } from './okx.js'

const baseUrl = 'https://web3.okx.com'
const defaultChains = ['1', '10', '42161', '8453', '56', '137', '43114', '59144', '324', '534352', '196']

export interface OkxWeb3Chain {
  id: string
  name: string
  code: string
  nativeSymbol: string
}

export const okxWeb3Chains: Record<string, OkxWeb3Chain> = {
  '1': { id: 'ethereum', name: 'Ethereum', code: 'ETH', nativeSymbol: 'ETH' },
  '10': { id: 'optimism', name: 'Optimism', code: 'OP', nativeSymbol: 'ETH' },
  '56': { id: 'bnb-smart-chain', name: 'BNB Smart Chain', code: 'BSC', nativeSymbol: 'BNB' },
  '137': { id: 'polygon', name: 'Polygon', code: 'POL', nativeSymbol: 'POL' },
  '196': { id: 'x-layer', name: 'X Layer', code: 'XLAYER', nativeSymbol: 'OKB' },
  '324': { id: 'zksync-era', name: 'zkSync Era', code: 'ZKSYNC', nativeSymbol: 'ETH' },
  '42161': { id: 'arbitrum', name: 'Arbitrum One', code: 'ARB', nativeSymbol: 'ETH' },
  '43114': { id: 'avalanche-c', name: 'Avalanche C-Chain', code: 'AVAX', nativeSymbol: 'AVAX' },
  '59144': { id: 'linea', name: 'Linea', code: 'LINEA', nativeSymbol: 'ETH' },
  '8453': { id: 'base', name: 'Base', code: 'BASE', nativeSymbol: 'ETH' },
  '534352': { id: 'scroll', name: 'Scroll', code: 'SCROLL', nativeSymbol: 'ETH' },
}

interface OkxWeb3Credentials {
  apiKey: string
  secret: string
  passphrase: string
  walletAddress: string
}

interface AddressAmount {
  address?: unknown
  amount?: unknown
}

export interface OkxWeb3Transaction extends Record<string, unknown> {
  chainIndex?: unknown
  txHash?: unknown
  itype?: unknown
  txTime?: unknown
  from?: AddressAmount[]
  to?: AddressAmount[]
  tokenContractAddress?: unknown
  amount?: unknown
  symbol?: unknown
  txFee?: unknown
  txStatus?: unknown
  hitBlacklist?: unknown
}

interface OkxWeb3Page {
  cursor?: unknown
  transactions?: OkxWeb3Transaction[]
}

export interface OkxWeb3FetchProgress {
  chainIndex: string
  page: number
  fetched: number
}

interface ChainResult {
  records: OkxWeb3Transaction[]
  cursor: string
  error?: string
}

export type OkxWeb3SyncCursors = Record<string, string>

function credentials(): OkxWeb3Credentials | null { return capitalConnection().wallet ?? null }

export function okxWeb3Configured(): boolean {
  return credentials() !== null
}

function maskAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : '••••'
}

export function okxWeb3ConnectionStatus(): { configured: boolean; maskedAddress: string | null } {
  const auth = credentials()
  return auth ? { configured: true, maskedAddress: maskAddress(auth.walletAddress) } : { configured: false, maskedAddress: null }
}

function configuredChainIds() {
  const requested = (capitalConnection().wallet?.chainIds || defaultChains.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set(requested)].filter((chainIndex) => okxWeb3Chains[chainIndex])
}

async function okxWeb3Request<T>(path: string): Promise<T> {
  const auth = credentials()
  if (!auth) throw new Error('OKX_WEB3_NOT_CONFIGURED')
  const timestamp = new Date().toISOString()
  const signature = createHmac('sha256', auth.secret).update(`${timestamp}GET${path}`).digest('base64')
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(30000),
    headers: {
      'OK-ACCESS-KEY': auth.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': auth.passphrase,
    },
  })
  if (!response.ok) throw new Error(`OKX_WEB3_HTTP_${response.status}`)
  const result = (await response.json()) as { code: string; msg: string; data: T }
  if (result.code !== '0') throw new Error(`OKX_WEB3_${result.code}: ошибка источника`)
  return result.data
}

function retryable(error: unknown) {
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message : ''
  return /^OKX_WEB3_HTTP_(429|5\d\d)$/.test(message) || /^OKX_WEB3_(50011|50040):/.test(message)
}

export async function okxWeb3Get<T>(path: string): Promise<T> {
  const baseDelay = Math.max(0, Math.min(5_000, Number(process.env.OKX_WEB3_RETRY_BASE_MS || 300)))
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await okxWeb3Request<T>(path)
    } catch (error) {
      lastError = error
      if (attempt === 2 || !retryable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt))
    }
  }
  throw lastError
}

const text = (value: unknown) => String(value ?? '').trim()

function decimal(value: unknown) {
  try {
    return new Decimal(text(value))
  } catch {
    return null
  }
}

function recordAddressMatch(items: AddressAmount[] | undefined, walletAddress: string) {
  return items?.some((item) => text(item.address).toLowerCase() === walletAddress.toLowerCase()) ?? false
}

export function okxWeb3RecordRevision(record: OkxWeb3Transaction): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

export function okxWeb3ExternalId(record: OkxWeb3Transaction): string {
  const chainIndex = text(record.chainIndex)
  const txHash = text(record.txHash)
  if (!chainIndex || !txHash) return ''
  const discriminator = createHash('sha256')
    .update(
      JSON.stringify({
        itype: text(record.itype),
        contract: text(record.tokenContractAddress).toLowerCase(),
        symbol: text(record.symbol),
        amount: text(record.amount),
        from: record.from,
        to: record.to,
      }),
    )
    .digest('hex')
    .slice(0, 20)
  return `wallet:${chainIndex}:${txHash.toLowerCase()}:${discriminator}`
}

export function isSuspiciousOkxWeb3Token(record: OkxWeb3Transaction): boolean {
  if (record.hitBlacklist === true || text(record.hitBlacklist).toLowerCase() === 'true') return true
  const symbol = text(record.symbol)
  if (!symbol || symbol.length > 24 || /[^\x20-\x7E]/.test(symbol)) return true
  return /(?:https?:|www\.|\bclaim\b|\breward\b|\bairdrop\b|\bvisit\b|[a-z0-9-]+\.(?:top|xyz|com|site|click|link|live|shop))/i.test(symbol)
}

function occurredAt(record: OkxWeb3Transaction) {
  const timestamp = Number(text(record.txTime))
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null
}

/** Maps successful, non-spam wallet movements into reviewable ledger drafts. */
export function mapOkxWeb3Record(record: OkxWeb3Transaction, walletAddress: string): NormalizedOperationInput | null {
  const chain = okxWeb3Chains[text(record.chainIndex)]
  const date = occurredAt(record)
  const externalId = okxWeb3ExternalId(record)
  const amount = text(record.amount)
  const symbol = text(record.symbol)
  const txHash = text(record.txHash)
  if (!chain || !date || !externalId || !txHash || !symbol || !decimal(amount)?.gt(0)) return null
  if (text(record.txStatus).toLowerCase() !== 'success' || isSuspiciousOkxWeb3Token(record)) return null

  const inFrom = recordAddressMatch(record.from, walletAddress)
  const inTo = recordAddressMatch(record.to, walletAddress)
  if (inFrom === inTo) return null

  const incoming = inTo
  const assetId = okxAssetId(symbol)
  if (!assetId) return null
  const counterparty = text((incoming ? record.from : record.to)?.[0]?.address)
  const fee = text(record.txFee)

  return {
    occurredAt: date,
    timezone: 'UTC',
    type: 'transfer',
    status: 'needs_review',
    source: 'okx_wallet',
    externalId,
    externalRevision: okxWeb3RecordRevision(record),
    locationFromId: incoming ? 'external-wallet' : 'okx-wallet',
    locationToId: incoming ? 'okx-wallet' : 'external-wallet',
    networkId: chain.id,
    txHash,
    destinationAddress: counterparty || undefined,
    note: incoming
      ? 'Импортировано из OKX Wallet API — проверь отправителя'
      : 'Импортировано из OKX Wallet API — проверь получателя и комиссию',
    legs: [
      { direction: 'out', assetId, amount, locationId: incoming ? 'external-wallet' : 'okx-wallet' },
      { direction: 'in', assetId, amount, locationId: incoming ? 'okx-wallet' : 'external-wallet' },
      ...(!incoming && decimal(fee)?.gt(0)
        ? [
            {
              direction: 'fee' as const,
              assetId: okxAssetId(chain.nativeSymbol),
              amount: fee,
              locationId: 'okx-wallet',
            },
          ]
        : []),
    ],
  }
}

async function fetchChain(
  chainIndex: string,
  stopExternalId?: string,
  onProgress?: (progress: OkxWeb3FetchProgress) => void,
): Promise<ChainResult> {
  const auth = credentials()
  if (!auth) throw new Error('OKX_WEB3_NOT_CONFIGURED')
  const configuredPages = Number(process.env.OKX_WEB3_MAX_PAGES || 20)
  const maxPages = Number.isInteger(configuredPages) ? Math.max(1, Math.min(100, configuredPages)) : 20
  const records: OkxWeb3Transaction[] = []
  let cursor = ''
  let newestExternalId = ''

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ address: auth.walletAddress, chains: chainIndex, limit: '100' })
    if (cursor) params.set('cursor', cursor)
    let payload: OkxWeb3Page[]
    try {
      payload = await okxWeb3Get<OkxWeb3Page[]>(`/api/v6/dex/post-transaction/transactions-by-address?${params}`)
    } catch (error) {
      return {
        records,
        cursor: newestExternalId || stopExternalId || '',
        error: error instanceof Error ? error.message : 'OKX_WEB3_UNKNOWN_ERROR',
      }
    }
    const batch = Array.isArray(payload?.[0]?.transactions) ? payload[0]!.transactions! : []
    if (!newestExternalId && batch[0]) newestExternalId = okxWeb3ExternalId(batch[0])
    const stopIndex = stopExternalId ? batch.findIndex((record) => okxWeb3ExternalId(record) === stopExternalId) : -1
    records.push(...(stopIndex >= 0 ? batch.slice(0, stopIndex) : batch))
    onProgress?.({ chainIndex, page: page + 1, fetched: records.length })
    const nextCursor = text(payload?.[0]?.cursor)
    if (stopIndex >= 0 || batch.length < 100 || !nextCursor || nextCursor === cursor) break
    cursor = nextCursor
  }

  return { records, cursor: newestExternalId || stopExternalId || '' }
}

export async function fetchOkxWeb3History(onProgress?: (progress: OkxWeb3FetchProgress) => void, previousCursors: OkxWeb3SyncCursors = {}) {
  const chainIds = configuredChainIds()
  const delay = Math.max(0, Math.min(5_000, Number(process.env.OKX_WEB3_CHAIN_DELAY_MS || 300)))
  const results: Array<readonly [string, ChainResult]> = []
  // OnchainOS applies a shared request limit to this endpoint, so chains must not be fanned out concurrently.
  for (const [index, chainIndex] of chainIds.entries()) {
    if (index && delay) await new Promise((resolve) => setTimeout(resolve, delay))
    results.push([chainIndex, await fetchChain(chainIndex, previousCursors[chainIndex], onProgress)] as const)
  }
  return {
    history: Object.fromEntries(results.map(([chainIndex, result]) => [chainIndex, result.records])),
    errors: results.flatMap(([chainIndex, result]) => (result.error ? [`${chainIndex}: ${result.error}`] : [])),
    cursors: Object.fromEntries(results.map(([chainIndex, result]) => [chainIndex, result.cursor])),
  }
}

export function configuredOkxWalletAddress(): string | null {
  return credentials()?.walletAddress ?? null
}
