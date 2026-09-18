import { z } from 'zod'
import { operationInputSchema, operationLegInputSchema } from './contracts.js'

const id = z.string().min(1).max(200)
const timestamp = z.iso.datetime({ offset: true })
const referenceName = z.string().min(1).max(200)
export const referenceSchema = z.object({
  assets: z.array(z.object({ id, symbol: referenceName, name: referenceName, kind: z.enum(['fiat', 'crypto']), decimals: z.number().int().min(0).max(18) })).max(10000),
  locations: z.array(z.object({ id, name: referenceName, kind: z.enum(['fiat', 'exchange', 'wallet']) })).max(10000),
  networks: z.array(z.object({ id, name: referenceName, code: referenceName })).max(10000),
})
export const restorableOperationSchema = z.preprocess(value => {
  if (!value || typeof value !== 'object' || !('legs' in value) || !Array.isArray(value.legs)) return value
  // Legacy PostgreSQL exports keep all 18/8 scale digits. Trailing zeroes are
  // storage formatting, not additional asset precision. Keep every significant digit.
  const decimal = (input: unknown) => typeof input === 'string' && /^\d+([.,]\d+)?$/.test(input) ? input.replace(',', '.').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : input
  return { ...value, legs: value.legs.map(leg => ({ ...leg, amount: decimal(leg.amount), fiatValue: decimal(leg.fiatValue ?? undefined), unitPrice: decimal(leg.unitPrice ?? undefined) })) }
}, operationInputSchema.safeExtend({
  id: id.optional(),
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
  archivedAt: timestamp.nullable().optional(),
  legs: z.array(operationLegInputSchema.extend({ id: id.optional(), position: z.number().int().nonnegative().optional() })).min(2).max(20),
}))

// v1 is the existing DeFi format; v2 adds audit and source metadata, never credentials.
export const backupSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  exportedAt: timestamp.optional(),
  settings: z.object({ baseCurrency: z.literal('RUB').optional(), timezone: z.string().max(100).optional(), numberFormat: z.string().max(100).optional() }).optional(),
  references: referenceSchema.optional(),
  operations: z.array(restorableOperationSchema).max(100000),
  auditEvents: z.array(z.object({ id, operationId: id.nullable(), action: z.string().max(100), payload: z.record(z.string(), z.unknown()), createdAt: timestamp })).max(500000).optional(),
  syncSources: z.array(z.object({ id, displayName: referenceName, enabled: z.boolean(), cursor: z.string().nullable(), lastSuccessAt: timestamp.nullable(), updatedAt: timestamp })).max(1000).optional(),
  syncRuns: z.array(z.object({ id, source: z.enum(['okx_exchange', 'okx_wallet']), status: z.string().max(30), cursor: z.string().nullable(), importedCount: z.number().int().nonnegative(), error: z.string().nullable(), startedAt: timestamp, finishedAt: timestamp.nullable() })).max(100000).optional(),
  externalRecords: z.array(z.object({ id, source: z.enum(['okx_exchange', 'okx_wallet']), externalId: id, revision: z.string().nullable(), kind: z.string().max(100), payload: z.record(z.string(), z.unknown()), importedAt: timestamp })).max(500000).optional(),
})
export type BackupPayload = z.infer<typeof backupSchema>
export type RestorableOperation = z.infer<typeof restorableOperationSchema>
