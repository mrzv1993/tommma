import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { calculatePortfolio } from './shared/domain.js'
import { operationInputSchema, operationSources, operationStatuses, operationTypes, operationSorts } from './shared/contracts.js'
import { CapitalError, allOperations, archiveOperation, backupData, ensureReferences, getReferences, listOperations, locked, restoreBackup, writeOperation } from './repository.js'
import { createCapitalSync, type SyncSource } from './sync.js'
import { withCapitalOwner } from './connections.js'
import { okxConnectionStatus } from './okx.js'
import { configuredOkxWalletAddress, okxWeb3ConnectionStatus } from './okx-web3.js'

const filtersSchema = z.object({
  search: z.string().max(200).optional(), type: z.enum(operationTypes).optional(), status: z.enum(operationStatuses).optional(), source: z.enum(operationSources).optional(),
  assetId: z.string().max(200).optional(), locationId: z.string().max(200).optional(), networkId: z.string().max(200).optional(),
  dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(), page: z.coerce.number().int().positive().max(10000000).optional(),
  pageSize: z.coerce.number().pipe(z.union([z.literal(20), z.literal(50), z.literal(100)])).optional(), sort: z.enum(operationSorts).optional(),
})
const idParam = z.object({ id: z.string().min(1).max(200) })
const optionsSchema = z.object({ allowDuplicate: z.enum(['true']).optional(), confirmReview: z.enum(['true']).optional() })

export function registerCapitalRoutes(app: FastifyInstance, prisma: PrismaClient, authenticate: (request: FastifyRequest) => Promise<bigint | null>, allowedOrigins: Set<string> = new Set()) {
  const sync = createCapitalSync(prisma)
  app.register(async capital => {
    const owners = new WeakMap<FastifyRequest, bigint>()
    const owner = (request: FastifyRequest) => owners.get(request)!
    capital.addHook('preHandler', async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      const userId = await authenticate(request)
      if (!userId || !await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) return reply.code(401).send({ error: 'Требуется вход в Tommma' })
      if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
        const origin = request.headers.origin
        const bearer = request.headers.authorization?.startsWith('Bearer ')
        if ((origin && !allowedOrigins.has(origin)) || (!origin && !bearer)) return reply.code(403).send({ error: 'Недопустимый источник запроса' })
      }
      if (request.headers['x-capital-owner'] && request.headers['x-capital-owner'] !== String(userId)) return reply.code(403).send({ error: 'Аккаунт изменился. Откройте раздел заново.' })
      owners.set(request, userId)
    })
    capital.setErrorHandler((error, _request, reply) => {
      if (error instanceof CapitalError) return reply.code(error.status).send({ error: error.message, code: error.code })
      if (error instanceof z.ZodError) return reply.code(422).send({ error: 'Проверьте поля запроса', issues: error.flatten() })
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2003'].includes(error.code)) return reply.code(409).send({ error: 'Конфликт записей или связанных данных' })
      // Do not log a Prisma error containing financial arguments or a provider payload.
      capital.log.error({ name: error instanceof Error ? error.name : 'UnknownError' }, 'Capital request failed')
      return reply.code(500).send({ error: 'Не удалось выполнить действие. Повторите попытку.' })
    })
    capital.get('/references', async request => locked(prisma, owner(request), async db => { await ensureReferences(db, owner(request)); return getReferences(db, owner(request)) }))
    capital.get('/snapshot', async request => prisma.$transaction(async db => {
      const userId = owner(request)
      const [page, completed, references] = await Promise.all([listOperations(db, userId, filtersSchema.parse(request.query)), allOperations(db, userId, true), getReferences(db, userId)])
      return { page, completed, references, portfolio: calculatePortfolio(completed) }
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 }))
    capital.get('/operations', async request => listOperations(prisma, owner(request), filtersSchema.parse(request.query)))
    capital.get('/export', async request => prisma.$transaction(async db => {
      const filters = filtersSchema.parse(request.query)
      const first = await listOperations(db, owner(request), { ...filters, page: 1, pageSize: 100 })
      const items = [...first.items]
      for (let page = 2; items.length < first.total; page++) items.push(...(await listOperations(db, owner(request), { ...filters, page, pageSize: 100 })).items)
      return { items }
    }, { isolationLevel: 'RepeatableRead', timeout: 120000 }))
    capital.get('/operations/:id', async (request, reply) => {
      const row = await prisma.capitalOperation.findUnique({ where: { userId_id: { userId: owner(request), id: idParam.parse(request.params).id } }, include: { legs: { orderBy: { position: 'asc' } } } })
      if (!row) return reply.code(404).send({ error: 'Операция не найдена' })
      const { serializeOperation } = await import('./repository.js')
      return serializeOperation(row)
    })
    capital.post('/operations', async (request, reply) => {
      const input = operationInputSchema.parse(request.body)
      if (input.source !== 'manual') throw new CapitalError(422, 'Импортированные операции создаются синхронизацией или восстановлением')
      const opts = optionsSchema.parse(request.query)
      const operation = await locked(prisma, owner(request), async db => {
        await ensureReferences(db, owner(request))
        return writeOperation(db, owner(request), input, { allowDuplicate: opts.allowDuplicate === 'true' })
      })
      return reply.code(201).send(operation)
    })
    capital.put('/operations/:id', async request => {
      const opts = optionsSchema.parse(request.query)
      const input = operationInputSchema.parse(request.body)
      const base = z.object({ baseUpdatedAt: z.iso.datetime().optional() }).parse(request.body)
      return locked(prisma, owner(request), db => writeOperation(db, owner(request), input, { id: idParam.parse(request.params).id, allowDuplicate: opts.allowDuplicate === 'true', confirmReview: opts.confirmReview === 'true', baseUpdatedAt: base.baseUpdatedAt }))
    })
    capital.delete('/operations/:id', async (request, reply) => {
      await locked(prisma, owner(request), db => archiveOperation(db, owner(request), idParam.parse(request.params).id))
      return reply.code(204).send()
    })
    capital.get('/portfolio', async request => calculatePortfolio(await allOperations(prisma, owner(request), true)))
    capital.get('/portfolio/operations', async request => allOperations(prisma, owner(request), true))
    capital.get('/audit', async request => {
      const { operationId, page } = z.object({ operationId: z.string().max(200).optional(), page: z.coerce.number().int().positive().max(1000000).default(1) }).parse(request.query)
      const where = { userId: owner(request), ...(operationId ? { operationId } : {}) }
      const [rows, total] = await prisma.$transaction([prisma.capitalAuditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, skip: (page - 1) * 100 }), prisma.capitalAuditEvent.count({ where })])
      return { items: rows.map(({ userId: _, ...row }) => row), total, page }
    })
    capital.get('/backup', async request => prisma.$transaction(db => backupData(db, owner(request)), { isolationLevel: 'RepeatableRead', timeout: 120000 }))
    capital.post('/backup/restore', { bodyLimit: 32 * 1024 * 1024 }, async request => locked(prisma, owner(request), db => restoreBackup(db, owner(request), request.body)))
    capital.get('/backup/state', async request => {
      const row = await prisma.capitalSetting.findUnique({ where: { userId_key: { userId: owner(request), key: 'last_backup_at' } } })
      return { lastBackupAt: typeof row?.value === 'string' ? row.value : null }
    })
    capital.post('/backup/created', async request => {
      const value = new Date().toISOString(), userId = owner(request), key = 'last_backup_at'
      await prisma.capitalSetting.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, value }, update: { value, updatedAt: new Date() } })
      return { lastBackupAt: value }
    })
    for (const [slug, source] of [['okx','okx_exchange'],['okx-wallet','okx_wallet']] as const) {
      capital.get(`/integrations/${slug}/status`, async request => withCapitalOwner(owner(request), async () => {
        const connection = source === 'okx_exchange' ? okxConnectionStatus() : okxWeb3ConnectionStatus()
        const sourceId = source === 'okx_wallet' ? `okx_wallet:${configuredOkxWalletAddress()}` : source
        const row = await prisma.capitalSyncSource.findUnique({ where: { userId_id: { userId: owner(request), id: sourceId } } })
        return { ...connection, lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null }
      }))
      capital.get(`/sync/${slug}/latest`, async request => sync.status(owner(request), source))
      capital.get(`/sync/${slug}/:id`, async (request, reply) => (await sync.status(owner(request), source, idParam.parse(request.params).id)) ?? reply.code(404).send({ error: 'Запуск не найден' }))
      capital.post(`/sync/${slug}`, async (request, reply) => reply.code(202).send(await sync.start(owner(request), source as SyncSource)))
    }
    capital.addHook('onClose', async () => { await sync.wait() })
  }, { prefix: '/capital' })
  return sync
}
