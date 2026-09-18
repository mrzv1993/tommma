import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'

const ownerContext = new AsyncLocalStorage<string>()
const connectionSchema = z.object({
  exchange: z.object({ apiKey: z.string().min(1), secret: z.string().min(1), passphrase: z.string().min(1) }).optional(),
  wallet: z.object({ apiKey: z.string().min(1), secret: z.string().min(1), passphrase: z.string().min(1), walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainIds: z.string().optional() }).optional(),
})
export type CapitalConnection = z.infer<typeof connectionSchema>
export const withCapitalOwner = <T>(userId: bigint, action: () => T) => ownerContext.run(String(userId), action)

// Resolve only the authenticated owner. No global-key fallback for other accounts.
export function capitalConnection(): CapitalConnection {
  const userId = ownerContext.getStore()
  if (!userId) return {}
  const file = process.env.CAPITAL_CONNECTIONS_FILE
  if (file) {
    try {
      const stat = statSync(file)
      if ((stat.mode & 0o077) !== 0) throw new Error('unsafe mode')
      const values = z.record(z.string().regex(/^\d+$/), connectionSchema).parse(JSON.parse(readFileSync(file, 'utf8')))
      return values[userId] ?? {}
    } catch { throw new Error('CAPITAL_CONNECTIONS_INVALID') }
  }
  if (process.env.CAPITAL_OKX_OWNER_USER_ID !== userId) return {}
  const e = process.env
  return connectionSchema.parse({
    ...(e.OKX_API_KEY && e.OKX_API_SECRET && e.OKX_PASSPHRASE ? { exchange: { apiKey: e.OKX_API_KEY, secret: e.OKX_API_SECRET, passphrase: e.OKX_PASSPHRASE } } : {}),
    ...(e.OKX_WEB3_API_KEY && e.OKX_WEB3_API_SECRET && e.OKX_WEB3_PASSPHRASE && e.OKX_WALLET_ADDRESS ? { wallet: { apiKey: e.OKX_WEB3_API_KEY, secret: e.OKX_WEB3_API_SECRET, passphrase: e.OKX_WEB3_PASSPHRASE, walletAddress: e.OKX_WALLET_ADDRESS.toLowerCase(), chainIds: e.OKX_WEB3_CHAIN_IDS } } : {}),
  })
}
