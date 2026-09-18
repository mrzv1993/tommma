import { capitalConnection } from './connections.js'
import { createHash, createHmac } from 'node:crypto'
import { Decimal } from 'decimal.js'
import type { NormalizedOperationInput } from './shared/contracts.js'

const baseUrl = 'https://www.okx.com'

function credentials() { return capitalConnection().exchange ?? null }

export function okxConfigured(): boolean {
  return credentials() !== null
}

export function okxConnectionStatus(): { configured: boolean; maskedApiKey: string | null } {
  const auth = credentials()
  if (!auth) return { configured: false, maskedApiKey: null }
  return { configured: true, maskedApiKey: `••••${auth.apiKey.slice(-4)}` }
}

async function okxRequest<T>(path: string): Promise<T> {
  const auth = credentials()
  if (!auth) throw new Error('OKX_NOT_CONFIGURED')
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
  if (!response.ok) throw new Error(`OKX_HTTP_${response.status}`)
  const result = (await response.json()) as { code: string; msg: string; data: T }
  if (result.code !== '0') throw new Error(`OKX_${result.code}: ошибка источника`)
  return result.data
}

function retryable(error: unknown) {
  if (error instanceof TypeError) return true
  const message = error instanceof Error ? error.message : ''
  return /^OKX_HTTP_(429|5\d\d)$/.test(message) || /^OKX_(50011|50040):/.test(message)
}

export async function okxGet<T>(path: string): Promise<T> {
  const baseDelay = Math.max(0, Math.min(5_000, Number(process.env.OKX_RETRY_BASE_MS || 300)))
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await okxRequest<T>(path)
    } catch (error) {
      lastError = error
      if (attempt === 2 || !retryable(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** attempt))
    }
  }
  throw lastError
}

export interface OkxFetchProgress {
  kind: string
  page: number
  fetched: number
}

interface OkxPageResult {
  records: Record<string, unknown>[]
  error?: string
}

export type OkxSyncCursors = Record<string, string>

export function okxExternalId(kind: string, record: Record<string, unknown>): string {
  const id = String(
    kind === 'deposits'
      ? record.depId || record.txId
      : kind === 'withdrawals'
        ? record.wdId || record.txId
        : kind === 'fills'
          ? record.tradeId || record.billId
          : kind === 'converts'
            ? record.tradeId || record.clTReqId
            : record.billId || record.tradeId || record.txId || '',
  )
  return id ? `${kind}:${id}` : ''
}

export function okxRecordRevision(record: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex')
}

export async function fetchOkxHistory(onProgress?: (progress: OkxFetchProgress) => void, previousCursors: OkxSyncCursors = {}) {
  const sources = [
    ['deposits', '/api/v5/asset/deposit-history?limit=100', 'ts'],
    ['withdrawals', '/api/v5/asset/withdrawal-history?limit=100', 'ts'],
    ['fills', '/api/v5/trade/fills-history?instType=SPOT&limit=100', 'billId'],
    ['converts', '/api/v5/asset/convert/history?limit=100', 'ts'],
    ['bills', '/api/v5/account/bills-archive?instType=SPOT&limit=100', 'billId'],
  ] as const
  const results = await Promise.all(
    sources.map(async ([kind, path, cursor]) => [kind, await okxPages(path, cursor, kind, previousCursors[kind], onProgress)] as const),
  )
  const history = Object.fromEntries(results.map(([kind, result]) => [kind, result.records])) as Record<
    (typeof sources)[number][0],
    Record<string, unknown>[]
  >
  const errors = results.flatMap(([kind, result]) => (result.error ? [`${kind}: ${result.error}`] : []))
  const cursors = Object.fromEntries(
    results.map(([kind, result]) => [kind, result.records[0] ? okxExternalId(kind, result.records[0]) : previousCursors[kind] || '']),
  )
  return { history, errors, cursors }
}

async function okxPages(
  basePath: string,
  cursorField: string,
  kind: string,
  stopExternalId?: string,
  onProgress?: (progress: OkxFetchProgress) => void,
): Promise<OkxPageResult> {
  const records: Record<string, unknown>[] = []
  const configuredPages = Number(process.env.OKX_MAX_PAGES || 20)
  const maxPages = Number.isInteger(configuredPages) ? Math.max(1, Math.min(100, configuredPages)) : 20
  let cursor = ''
  for (let page = 0; page < maxPages; page += 1) {
    let batch: Record<string, unknown>[]
    try {
      batch = await okxGet<Record<string, unknown>[]>(`${basePath}${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`)
    } catch (error) {
      return { records, error: error instanceof Error ? error.message : 'OKX_UNKNOWN_ERROR' }
    }
    const stopIndex = stopExternalId ? batch.findIndex((record) => okxExternalId(kind, record) === stopExternalId) : -1
    records.push(...(stopIndex >= 0 ? batch.slice(0, stopIndex) : batch))
    onProgress?.({ kind, page: page + 1, fetched: records.length })
    if (stopIndex >= 0 || batch.length < 100) break
    const nextCursor = String(batch.at(-1)?.[cursorField] ?? '')
    if (!nextCursor || nextCursor === cursor) break
    cursor = nextCursor
  }
  return { records }
}

const value = (record: Record<string, unknown>, key: string) => String(record[key] ?? '').trim()
export const okxAssetId = (symbol: string) =>
  symbol
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
function decimal(value: string) {
  try {
    return new Decimal(value)
  } catch {
    return null
  }
}

function occurredAt(record: Record<string, unknown>) {
  const timestamp = Number(value(record, 'fillTime') || value(record, 'ts') || value(record, 'uTime'))
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null
}

function networkId(chain: string) {
  const normalized = chain.toLowerCase()
  if (normalized.includes('arbitrum')) return 'arbitrum'
  if (normalized.includes('trc20') || normalized.includes('tron')) return 'tron'
  if (normalized.includes('erc20') || normalized.includes('ethereum')) return 'ethereum'
  if (normalized.includes('bitcoin')) return 'bitcoin'
  return undefined
}

/** Maps read-only OKX history into reviewable ledger drafts. Raw data is kept separately. */
export function mapOkxRecord(kind: string, record: Record<string, unknown>): NormalizedOperationInput | null {
  const date = occurredAt(record)
  if (!date) return null
  const common = {
    occurredAt: date,
    timezone: 'UTC',
    status: 'needs_review' as const,
    source: 'okx_exchange' as const,
    externalRevision: okxRecordRevision(record),
  }

  if (kind === 'deposits') {
    const assetId = okxAssetId(value(record, 'ccy'))
    const amount = value(record, 'amt')
    const id = value(record, 'depId') || value(record, 'txId')
    if (!assetId || !id || !amount || !decimal(amount)?.gt(0)) return null
    return {
      ...common,
      type: 'transfer',
      externalId: `${kind}:${id}`,
      locationFromId: 'external-wallet',
      locationToId: 'okx',
      networkId: networkId(value(record, 'chain')),
      txHash: value(record, 'txId') || undefined,
      destinationAddress: value(record, 'to') || value(record, 'addr') || undefined,
      note: 'Импортировано из истории пополнений OKX — проверь источник',
      legs: [
        { direction: 'out', assetId, amount, locationId: 'external-wallet' },
        { direction: 'in', assetId, amount, locationId: 'okx' },
      ],
    }
  }

  if (kind === 'withdrawals') {
    const assetId = okxAssetId(value(record, 'ccy'))
    const amount = value(record, 'amt')
    const id = value(record, 'wdId') || value(record, 'txId')
    if (!assetId || !id || !amount || !decimal(amount)?.gt(0)) return null
    const fee = value(record, 'fee')
    return {
      ...common,
      type: 'transfer',
      externalId: `${kind}:${id}`,
      locationFromId: 'okx',
      locationToId: 'external-wallet',
      networkId: networkId(value(record, 'chain')),
      txHash: value(record, 'txId') || undefined,
      destinationAddress: value(record, 'to') || value(record, 'addr') || undefined,
      note: 'Импортировано из истории выводов OKX — проверь кошелёк назначения',
      legs: [
        { direction: 'out', assetId, amount, locationId: 'okx' },
        { direction: 'in', assetId, amount, locationId: 'external-wallet' },
        ...(fee && decimal(fee)?.gt(0)
          ? [
              {
                direction: 'fee' as const,
                assetId: okxAssetId(value(record, 'feeCcy') || value(record, 'ccy')),
                amount: fee,
                locationId: 'okx',
              },
            ]
          : []),
      ],
    }
  }

  if (kind === 'fills') {
    const [base, quote] = value(record, 'instId').split('-')
    const side = value(record, 'side')
    const size = value(record, 'fillSz')
    const price = value(record, 'fillPx')
    const id = value(record, 'tradeId') || value(record, 'billId')
    const sizeValue = decimal(size)
    const priceValue = decimal(price)
    if (!base || !quote || !id || !['buy', 'sell'].includes(side) || !sizeValue?.gt(0) || !priceValue?.gt(0)) return null
    const baseId = okxAssetId(base)
    const quoteId = okxAssetId(quote)
    const quoteAmount = sizeValue.mul(priceValue).toFixed()
    const feeValue = value(record, 'fee') || value(record, 'fillFee')
    const parsedFee = decimal(feeValue)
    const fee = parsedFee?.lt(0) ? parsedFee.abs().toFixed() : ''
    const outgoing = side === 'buy' ? { assetId: quoteId, amount: quoteAmount } : { assetId: baseId, amount: size }
    const incoming = side === 'buy' ? { assetId: baseId, amount: size } : { assetId: quoteId, amount: quoteAmount }
    return {
      ...common,
      type: 'conversion',
      externalId: `${kind}:${id}`,
      locationFromId: 'okx',
      locationToId: 'okx',
      note: 'Импортировано из истории спотовых сделок OKX — проверь итоговые количества',
      legs: [
        { direction: 'out', ...outgoing, locationId: 'okx' },
        { direction: 'in', ...incoming, locationId: 'okx' },
        ...(fee
          ? [
              {
                direction: 'fee' as const,
                assetId: okxAssetId(value(record, 'feeCcy') || value(record, 'fillFeeCcy')),
                amount: fee,
                locationId: 'okx',
              },
            ]
          : []),
      ],
    }
  }

  if (kind === 'converts') {
    const outgoingAsset = okxAssetId(value(record, 'side') === 'buy' ? value(record, 'quoteCcy') : value(record, 'baseCcy'))
    const incomingAsset = okxAssetId(value(record, 'side') === 'buy' ? value(record, 'baseCcy') : value(record, 'quoteCcy'))
    const outgoingAmount = value(record, 'side') === 'buy' ? value(record, 'fillQuoteSz') : value(record, 'fillBaseSz')
    const incomingAmount = value(record, 'side') === 'buy' ? value(record, 'fillBaseSz') : value(record, 'fillQuoteSz')
    const id = value(record, 'tradeId') || value(record, 'clTReqId')
    if (!outgoingAsset || !incomingAsset || !id || !decimal(outgoingAmount)?.gt(0) || !decimal(incomingAmount)?.gt(0)) return null
    return {
      ...common,
      type: 'conversion',
      externalId: `${kind}:${id}`,
      locationFromId: 'okx',
      locationToId: 'okx',
      note: 'Импортировано из истории OKX Convert — проверь итоговые количества',
      legs: [
        { direction: 'out', assetId: outgoingAsset, amount: outgoingAmount, locationId: 'okx' },
        { direction: 'in', assetId: incomingAsset, amount: incomingAmount, locationId: 'okx' },
      ],
    }
  }

  return null
}
