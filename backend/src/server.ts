import 'dotenv/config'

import bcrypt from 'bcrypt'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import Fastify from 'fastify'
import type { FastifyRequest } from 'fastify'
import jwt from '@fastify/jwt'
import { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()
const app = Fastify({ logger: true })

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '0.0.0.0'
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

await app.register(cors, {
  origin: FRONTEND_ORIGIN,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
})
await app.register(cookie)
await app.register(jwt, {
  secret: JWT_SECRET,
  cookie: {
    cookieName: 'tommma_token',
    signed: false,
  },
})

type AuthPayload = { userId: string }

const subtaskSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  completed: z.boolean().optional().default(false),
  createdAt: z.number().int().nonnegative(),
})

const taskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  column: z.enum(['todo', 'not-do', 'anti-todo']),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurrenceParentId: z.string().min(1).max(64).nullable().optional(),
  recurrence: z.enum(['none', 'daily', 'weekly']),
  completed: z.boolean().optional().default(false),
  createdAt: z.number().int().nonnegative(),
  actualSeconds: z.number().int().nonnegative().optional().default(0),
  sessionSeconds: z.number().int().nonnegative().optional().default(0),
  sessionStartedAt: z.number().int().nonnegative().nullable().optional(),
  subtasks: z.array(subtaskSchema).optional().default([]),
})

const taskPatchSchema = taskSchema.partial().omit({ id: true })

const dailyEarningSchema = z.object({
  id: z.string().min(1).max(64),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectName: z.string().trim().min(1).max(120),
  amount: z.number().nonnegative(),
})

const dailyEarningPatchSchema = dailyEarningSchema.partial().omit({ id: true, dateKey: true })

function serializeUser(user: {
  id: bigint
  nickname: string
  email: string
  emailVerifiedAt?: Date | null
}) {
  return {
    id: user.id.toString(),
    nickname: user.nickname,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
  }
}

async function getAuthUserId(request: FastifyRequest): Promise<bigint | null> {
  try {
    await request.jwtVerify<AuthPayload>()
    const payload = request.user as AuthPayload | undefined
    const userId = payload?.userId
    if (!userId) return null
    return BigInt(userId)
  } catch {
    return null
  }
}

function serializeTask(row: {
  id: string
  title: string
  columnId: string
  dateKey: string
  recurrenceParentId: string | null
  recurrence: string
  completed: boolean
  createdAtMs: bigint
  actualSeconds: number
  sessionSeconds: number
  sessionStartedAtMs: bigint | null
  subtasks: Prisma.JsonValue
}) {
  return {
    id: row.id,
    title: row.title,
    column: row.columnId,
    dateKey: row.dateKey,
    recurrenceParentId: row.recurrenceParentId,
    recurrence: row.recurrence,
    completed: row.completed,
    createdAt: Number(row.createdAtMs),
    actualSeconds: row.actualSeconds,
    sessionSeconds: row.sessionSeconds,
    sessionStartedAt: row.sessionStartedAtMs ? Number(row.sessionStartedAtMs) : null,
    subtasks: row.subtasks,
  }
}

function serializeDailyEarning(row: {
  id: string
  dateKey: string
  projectName: string
  amountCents: number
}) {
  return {
    id: row.id,
    dateKey: row.dateKey,
    projectName: row.projectName,
    amount: row.amountCents / 100,
  }
}

app.get('/health', async () => ({ ok: true }))

app.post('/auth/register', async (request, reply) => {
  const schema = z.object({
    nickname: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9]+$/),
    email: z.string().trim().email(),
    password: z.string().min(8),
  })

  const parsed = schema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: 'Некорректные данные регистрации' })
  }

  const { nickname, email, password } = parsed.data
  const passwordHash = await bcrypt.hash(password, 10)

  try {
    const user = await prisma.user.create({
      data: {
        nickname,
        email: email.toLowerCase(),
        passwordHash,
        emailVerifiedAt: new Date(),
      },
      select: { id: true, nickname: true, email: true },
    })

    const token = await reply.jwtSign({ userId: user.id.toString() })
    reply.setCookie('tommma_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    })

    return { ok: true, user: serializeUser(user) }
  } catch (error) {
    request.log.error(error)
    return reply.code(409).send({ ok: false, error: 'Пользователь с таким email или никнеймом уже существует' })
  }
})

app.post('/auth/login', async (request, reply) => {
  const schema = z.object({
    login: z.string().trim().min(1),
    password: z.string().min(1),
  })

  const parsed = schema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, error: 'Некорректные данные входа' })
  }

  const { login, password } = parsed.data
  const normalizedEmail = login.toLowerCase()

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { nickname: login }],
    },
  })

  if (!user) {
    return reply.code(401).send({ ok: false, error: 'Неверный логин или пароль' })
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return reply.code(401).send({ ok: false, error: 'Неверный логин или пароль' })
  }

  const token = await reply.jwtSign({ userId: user.id.toString() })
  reply.setCookie('tommma_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })

  return {
    ok: true,
    user: serializeUser(user),
  }
})

app.get('/auth/session', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) return { ok: true, user: null }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      nickname: true,
      email: true,
      emailVerifiedAt: true,
    },
  })

  if (!user) {
    reply.clearCookie('tommma_token', { path: '/' })
    return { ok: true, user: null }
  }

  return { ok: true, user: serializeUser(user) }
})

app.post('/auth/logout', async (_request, reply) => {
  reply.clearCookie('tommma_token', { path: '/' })
  return { ok: true }
})

app.get('/tasks', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const rows = await prisma.task.findMany({
    where: { userId },
    orderBy: [{ createdAtMs: 'desc' }],
  })

  return { ok: true, tasks: rows.map((row) => serializeTask(row)) }
})

app.post('/tasks', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const parsed = taskSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid task payload' })
  }

  const task = parsed.data
  try {
    const created = await prisma.task.create({
      data: {
        id: task.id,
        userId,
        title: task.title,
        columnId: task.column,
        dateKey: task.dateKey,
        recurrenceParentId: task.recurrenceParentId ?? null,
        recurrence: task.recurrence,
        completed: task.completed,
        createdAtMs: BigInt(task.createdAt),
        actualSeconds: task.actualSeconds,
        sessionSeconds: task.sessionSeconds,
        sessionStartedAtMs: task.sessionStartedAt ? BigInt(task.sessionStartedAt) : null,
        subtasks: task.subtasks as Prisma.InputJsonValue,
      },
    })
    return { ok: true, task: serializeTask(created) }
  } catch (_error) {
    return reply.code(409).send({ ok: false, error: 'Task with same id already exists' })
  }
})

app.patch('/tasks/:id', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params)
  if (!params.success) {
    return reply.code(400).send({ ok: false, error: 'Invalid task id' })
  }

  const parsed = taskPatchSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid task payload' })
  }

  const patch = parsed.data
  const updateData: Prisma.TaskUpdateInput = {}
  if (typeof patch.title === 'string') updateData.title = patch.title
  if (typeof patch.column === 'string') updateData.columnId = patch.column
  if (typeof patch.dateKey === 'string') updateData.dateKey = patch.dateKey
  if (patch.recurrenceParentId !== undefined) updateData.recurrenceParentId = patch.recurrenceParentId
  if (typeof patch.recurrence === 'string') updateData.recurrence = patch.recurrence
  if (typeof patch.completed === 'boolean') updateData.completed = patch.completed
  if (typeof patch.createdAt === 'number') updateData.createdAtMs = BigInt(patch.createdAt)
  if (typeof patch.actualSeconds === 'number') updateData.actualSeconds = patch.actualSeconds
  if (typeof patch.sessionSeconds === 'number') updateData.sessionSeconds = patch.sessionSeconds
  if (patch.sessionStartedAt !== undefined)
    updateData.sessionStartedAtMs = patch.sessionStartedAt ? BigInt(patch.sessionStartedAt) : null
  if (patch.subtasks !== undefined) updateData.subtasks = patch.subtasks as Prisma.InputJsonValue

  const existing = await prisma.task.findFirst({
    where: { id: params.data.id, userId },
  })
  if (!existing) {
    return reply.code(404).send({ ok: false, error: 'Task not found' })
  }

  const updated = await prisma.task.update({
    where: { id: params.data.id },
    data: updateData,
  })
  return { ok: true, task: serializeTask(updated) }
})

app.delete('/tasks/:id', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params)
  if (!params.success) {
    return reply.code(400).send({ ok: false, error: 'Invalid task id' })
  }

  const existing = await prisma.task.findFirst({
    where: { id: params.data.id, userId },
  })
  if (!existing) {
    return reply.code(404).send({ ok: false, error: 'Task not found' })
  }

  await prisma.task.delete({ where: { id: params.data.id } })
  return { ok: true }
})

app.get('/earnings', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const rows = await prisma.dailyEarning.findMany({
    where: { userId },
    orderBy: [{ dateKey: 'desc' }],
  })
  return { ok: true, earnings: rows.map((row) => serializeDailyEarning(row)) }
})

app.post('/earnings', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const parsed = dailyEarningSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid earning payload' })
  }

  const earning = parsed.data
  try {
    const created = await prisma.dailyEarning.create({
      data: {
        id: earning.id,
        userId,
        dateKey: earning.dateKey,
        projectName: earning.projectName,
        amountCents: Math.round(earning.amount * 100),
      },
    })
    return { ok: true, earning: serializeDailyEarning(created) }
  } catch (_error) {
    return reply.code(409).send({ ok: false, error: 'Earning with same id already exists' })
  }
})

app.patch('/earnings/:id', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params)
  if (!params.success) {
    return reply.code(400).send({ ok: false, error: 'Invalid earning id' })
  }

  const parsed = dailyEarningPatchSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid earning payload' })
  }

  const patch = parsed.data
  const updateData: Prisma.DailyEarningUpdateInput = {}
  if (typeof patch.projectName === 'string') updateData.projectName = patch.projectName
  if (typeof patch.amount === 'number') updateData.amountCents = Math.round(patch.amount * 100)

  const existing = await prisma.dailyEarning.findFirst({
    where: { id: params.data.id, userId },
  })
  if (!existing) {
    return reply.code(404).send({ ok: false, error: 'Earning not found' })
  }

  const updated = await prisma.dailyEarning.update({
    where: { id: params.data.id },
    data: updateData,
  })
  return { ok: true, earning: serializeDailyEarning(updated) }
})

app.delete('/earnings/:id', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const params = z.object({ id: z.string().min(1).max(64) }).safeParse(request.params)
  if (!params.success) {
    return reply.code(400).send({ ok: false, error: 'Invalid earning id' })
  }

  const existing = await prisma.dailyEarning.findFirst({
    where: { id: params.data.id, userId },
  })
  if (!existing) {
    return reply.code(404).send({ ok: false, error: 'Earning not found' })
  }

  await prisma.dailyEarning.delete({ where: { id: params.data.id } })
  return { ok: true }
})

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`Backend listening on http://${HOST}:${PORT}`)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

void start()
