import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma, type Goal, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { comparePriorityInboxTasks, comparePriorityTasks, priorityGroupForIndex, PRIORITY_RANK_STEP } from './priority-ranking.js'

const idSchema = z.string().min(1).max(64)
const createSchema = z.object({ id: idSchema, title: z.string().trim().min(1).max(255) }).strict()
const patchSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  completed: z.boolean().optional(),
  baseUpdatedAt: z.iso.datetime(),
  baseTitle: z.string().max(255).optional(),
}).strict().refine(value => value.title !== undefined || value.completed !== undefined)
const scoreSchema = z.object({ field: z.enum(['importance', 'urgency', 'overdue']), delta: z.union([z.literal(-1), z.literal(1)]) }).strict()
const moveSchema = z.object({ targetIndex: z.number().int().nonnegative() }).strict()

class GoalError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function serializeGoal({ userId: _userId, createdAtMs, ...row }: Goal) {
  return { ...row, createdAt: Number(createdAtMs) }
}

async function snapshot(tx: Prisma.TransactionClient, userId: bigint) {
  const goals = await tx.goal.findMany({ where: { userId }, orderBy: [{ createdAtMs: 'desc' }, { id: 'asc' }] })
  return { ok: true, goals: goals.map(serializeGoal) }
}

async function recalculate(tx: Prisma.TransactionClient, userId: bigint) {
  const ranked = (await tx.goal.findMany({ where: { userId, completed: false, deletedAt: null, priorityGroup: { not: null } } })).sort(comparePriorityTasks)
  for (const [index, goal] of ranked.entries()) {
    const priorityGroup = priorityGroupForIndex(index)
    if (goal.priorityGroup !== priorityGroup) await tx.goal.update({ where: { id: goal.id, userId }, data: { priorityGroup } })
  }
}

export function registerGoalRoutes(app: FastifyInstance, prisma: PrismaClient, getUserId: (request: FastifyRequest) => Promise<bigint | null>) {
  // Goal mutations share their own per-user lock. Tasks and focus sessions are untouched.
  const locked = <T>(userId: bigint, action: (tx: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'goals:' + userId}, 0))::text`
    return action(tx)
  })

  app.get('/goals', async (request, reply) => {
    const userId = await getUserId(request)
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
    return snapshot(prisma, userId)
  })

  app.post('/goals', async (request, reply) => {
    const userId = await getUserId(request)
    if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(422).send({ ok: false, error: 'Укажи название цели, до 255 символов' })
    try {
      return await locked(userId, async tx => {
        const existing = await tx.goal.findUnique({ where: { id: parsed.data.id } })
        if (existing) {
          // Retrying a creation after a lost response must not duplicate or overwrite it.
          if (existing.userId !== userId || existing.title !== parsed.data.title || existing.deletedAt) throw new GoalError(409, 'Не удалось создать цель с этим идентификатором')
          return snapshot(tx, userId)
        }
        const first = await tx.goal.findFirst({ where: { userId, completed: false, deletedAt: null, priorityGroup: null }, orderBy: { priorityRank: 'asc' } })
        await tx.goal.create({ data: { ...parsed.data, userId, createdAtMs: BigInt(Date.now()), priorityRank: (first?.priorityRank ?? 0) - PRIORITY_RANK_STEP } })
        return snapshot(tx, userId)
      })
    } catch (error) {
      if (error instanceof GoalError) return reply.code(error.status).send({ ok: false, error: error.message })
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return reply.code(409).send({ ok: false, error: 'Идентификатор цели уже занят' })
      throw error
    }
  })

  for (const action of ['edit', 'score', 'move', 'delete', 'restore'] as const) {
    const url = '/goals/:id' + ({ edit: '', score: '/priority-score', move: '/priority', delete: '', restore: '/restore' }[action])
    app.route({ method: action === 'delete' ? 'DELETE' : action === 'restore' ? 'POST' : 'PATCH', url, handler: async (request, reply) => {
      const userId = await getUserId(request)
      if (!userId) return reply.code(401).send({ ok: false, error: 'Unauthorized' })
      const params = z.object({ id: idSchema }).safeParse(request.params)
      if (!params.success) return reply.code(400).send({ ok: false, error: 'Некорректный идентификатор цели' })
      try {
        return await locked(userId, async tx => {
          const goal = await tx.goal.findFirst({ where: { id: params.data.id, userId } })
          if (!goal || (goal.deletedAt && action !== 'restore' && action !== 'delete')) throw new GoalError(404, 'Цель не найдена')
          const where = { id: goal.id, userId }
          if (action === 'edit') {
            const parsed = patchSchema.safeParse(request.body)
            if (!parsed.success) throw new GoalError(422, 'Некорректные данные цели')
            const stale = parsed.data.title !== undefined && parsed.data.completed === undefined && parsed.data.baseTitle !== undefined
              ? parsed.data.baseTitle !== goal.title
              : parsed.data.baseUpdatedAt !== goal.updatedAt.toISOString()
            if (stale) throw new GoalError(409, 'Цель уже изменена. Обнови список и повтори изменение')
            if (goal.completed && parsed.data.title !== undefined) throw new GoalError(409, 'Сначала верни цель во Входящие')
            const { title, completed } = parsed.data
            await tx.goal.update({ where, data: {
              ...(title !== undefined ? { title } : {}),
              ...(completed !== undefined && completed !== goal.completed ? {
                completed, completedAt: completed ? new Date() : null, priorityGroup: null,
              } : {}),
            } })
          } else if (action === 'score') {
            const parsed = scoreSchema.safeParse(request.body)
            if (!parsed.success) throw new GoalError(422, 'Некорректная оценка приоритета')
            if (goal.completed) throw new GoalError(409, 'Сначала верни цель во Входящие')
            const field = ({ importance: 'priorityImportance', urgency: 'priorityUrgency', overdue: 'priorityOverdue' } as const)[parsed.data.field]
            const value = Math.max(0, Math.min(9, goal[field] + parsed.data.delta))
            const scores = { priorityImportance: goal.priorityImportance, priorityUrgency: goal.priorityUrgency, priorityOverdue: goal.priorityOverdue, [field]: value }
            const ranked = Object.values(scores).some(score => score > 0)
            const last = ranked && goal.priorityGroup === null ? await tx.goal.findFirst({ where: { userId, completed: false, deletedAt: null, priorityGroup: { not: null } }, orderBy: { priorityRank: 'desc' } }) : null
            await tx.goal.update({ where, data: { ...scores, priorityGroup: ranked ? goal.priorityGroup ?? 9 : null,
              ...(ranked && goal.priorityGroup === null ? { priorityRank: (last?.priorityRank ?? 0) + PRIORITY_RANK_STEP } : {}),
            } })
          } else if (action === 'move') {
            const parsed = moveSchema.safeParse(request.body)
            if (!parsed.success) throw new GoalError(422, 'Некорректная позиция цели')
            if (goal.completed || goal.priorityGroup !== null) throw new GoalError(409, 'Перемещать можно только цели во Входящих')
            const inbox = (await tx.goal.findMany({ where: { userId, completed: false, deletedAt: null, priorityGroup: null, id: { not: goal.id } } })).sort(comparePriorityInboxTasks)
            inbox.splice(Math.min(parsed.data.targetIndex, inbox.length), 0, goal)
            for (const [index, row] of inbox.entries()) await tx.goal.update({ where: { id: row.id, userId }, data: { priorityRank: (index + 1) * PRIORITY_RANK_STEP } })
          } else if (action === 'delete') {
            if (!goal.deletedAt) await tx.goal.update({ where, data: { deletedAt: new Date(), priorityGroup: null } })
          } else if (goal.deletedAt) {
            await tx.goal.update({ where, data: { deletedAt: null, completed: false, completedAt: null, priorityGroup: null } })
          }
          await recalculate(tx, userId)
          return snapshot(tx, userId)
        })
      } catch (error) {
        if (error instanceof GoalError) return reply.code(error.status).send({ ok: false, error: error.message })
        throw error
      }
    } })
  }
}
