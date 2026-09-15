import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'

const idSchema = z.string().min(1).max(64)
const titleSchema = z.string().trim().min(1).max(255)
const createSchema = z.object({ id: idSchema, title: titleSchema }).strict()
const editSchema = z.object({ title: titleSchema, baseTitle: z.string().max(255) }).strict()
const moveSchema = z.object({ targetIndex: z.number().int().nonnegative().max(1_000_000) }).strict()
const emptySchema = z.object({}).strict()
const orderBy = [{ rank: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }] as const
const RANK_STEP = 1024

class ProcessError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function snapshot(tx: Prisma.TransactionClient, userId: bigint) {
  const rows = await tx.processItem.findMany({ where: { userId }, orderBy: [...orderBy] })
  return { ok: true, items: rows.map(({ userId: _owner, ...item }) => item) }
}

export function registerProcessRoutes(app: FastifyInstance, prisma: PrismaClient, getUserId: (request: FastifyRequest) => Promise<bigint | null>) {
  const locked = <T>(userId: bigint, action: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'process:' + userId}, 0))::text`
    return action(tx)
  })

  app.get('/process-items', async (request, reply) => {
    const userId = await getUserId(request)
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
    return snapshot(prisma, userId)
  })

  app.post('/process-items', async (request, reply) => {
    const userId = await getUserId(request)
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(422).send({ ok: false, error: 'Укажи название записи, до 255 символов' })
    try {
      return await locked(userId, async tx => {
        const existing = await tx.processItem.findUnique({ where: { id: parsed.data.id } })
        if (existing) {
          // A lost response can be retried with the same ID, without duplicating a record.
          if (existing.userId !== userId || existing.title !== parsed.data.title || existing.deletedAt) throw new ProcessError(409, 'Не удалось создать запись с этим идентификатором')
          return snapshot(tx, userId)
        }
        const first = await tx.processItem.findFirst({ where: { userId, deletedAt: null }, orderBy: [...orderBy] })
        await tx.processItem.create({ data: { ...parsed.data, userId, rank: (first?.rank ?? 0) - RANK_STEP } })
        return snapshot(tx, userId)
      })
    } catch (cause) {
      if (cause instanceof ProcessError) return reply.code(cause.status).send({ ok: false, error: cause.message })
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') return reply.code(409).send({ ok: false, error: 'Не удалось создать запись с этим идентификатором' })
      throw cause
    }
  })

  for (const action of ['edit', 'move', 'delete', 'restore'] as const) {
    app.route({
      method: action === 'delete' ? 'DELETE' : action === 'restore' ? 'POST' : 'PATCH',
      url: '/process-items/:id' + ({ edit: '', move: '/position', delete: '', restore: '/restore' }[action]),
      handler: async (request, reply) => {
        const userId = await getUserId(request)
        if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
        const params = z.object({ id: idSchema }).safeParse(request.params)
        if (!params.success) return reply.code(400).send({ ok: false, error: 'Некорректный идентификатор записи' })
        try {
          return await locked(userId, async tx => {
            const item = await tx.processItem.findFirst({ where: { id: params.data.id, userId } })
            if (!item || (item.deletedAt && action !== 'restore' && action !== 'delete')) throw new ProcessError(404, 'Запись не найдена')
            const where = { id: item.id, userId }
            if (action === 'edit') {
              const parsed = editSchema.safeParse(request.body)
              if (!parsed.success) throw new ProcessError(422, 'Некорректное название записи')
              // Reordering doesn't conflict with editing; a concurrent rename does.
              if (parsed.data.baseTitle !== item.title && parsed.data.title !== item.title) throw new ProcessError(409, 'Запись уже изменена. Обнови список и повтори изменение')
              await tx.processItem.update({ where, data: { title: parsed.data.title } })
            } else if (action === 'move') {
              const parsed = moveSchema.safeParse(request.body)
              if (!parsed.success) throw new ProcessError(422, 'Некорректная позиция записи')
              const items = await tx.processItem.findMany({ where: { userId, deletedAt: null, id: { not: item.id } }, orderBy: [...orderBy] })
              items.splice(Math.min(parsed.data.targetIndex, items.length), 0, item)
              for (const [index, row] of items.entries()) {
                const rank = (index + 1) * RANK_STEP
                if (row.rank !== rank) await tx.processItem.update({ where: { id: row.id, userId }, data: { rank } })
              }
            } else {
              if (!emptySchema.safeParse(request.body ?? {}).success) throw new ProcessError(422, 'Некорректные данные записи')
              if (action === 'delete' && !item.deletedAt) await tx.processItem.update({ where, data: { deletedAt: new Date() } })
              if (action === 'restore' && item.deletedAt) await tx.processItem.update({ where, data: { deletedAt: null } })
            }
            return snapshot(tx, userId)
          })
        } catch (cause) {
          if (cause instanceof ProcessError) return reply.code(cause.status).send({ ok: false, error: cause.message })
          throw cause
        }
      },
    })
  }
}
