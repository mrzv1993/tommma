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
const EXTRA_ALLOWED_ORIGINS = (process.env.EXTRA_ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const allowedOrigins = new Set([
  FRONTEND_ORIGIN,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://tommma.ru',
  'https://www.tommma.ru',
  'tauri://localhost',
  'http://tauri.localhost',
  ...EXTRA_ALLOWED_ORIGINS,
])

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true)
      return
    }
    callback(null, allowedOrigins.has(origin))
  },
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

const taskPatchSchema = taskSchema.partial().omit({ id: true }).extend({
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

const dailyEarningSchema = z.object({
  id: z.string().min(1).max(64),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectName: z.string().trim().min(1).max(120),
  amount: z.number().nonnegative(),
})

const dailyEarningPatchSchema = dailyEarningSchema.partial().omit({ id: true, dateKey: true }).extend({
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

const sidebarStorySchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
})

const sidebarSectionSchema = z.object({
  id: z.string().min(1).max(64),
  boardId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(255),
  position: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const sidebarCardSchema = z.object({
  id: z.string().min(1).max(64),
  sectionId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(255),
  completed: z.boolean().optional().default(false),
  position: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

const sidebarBoardSchema = z.object({
  sections: z.array(sidebarSectionSchema).default([]),
  cards: z.array(sidebarCardSchema).default([]),
})

const sidebarStateSchema = z.object({
  stories: z.array(sidebarStorySchema).default([]),
  boards: z.record(z.string().min(1).max(64), sidebarBoardSchema).default({}),
  deletedStoryKeys: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  deletedSectionIds: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  deletedCardIds: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  sidebarWidth: z.number().int().min(180).max(800).default(240),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

const noteSourceTypeSchema = z.enum(['book', 'article', 'video', 'course', 'podcast', 'social', 'other'])

const noteItemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  sourceType: noteSourceTypeSchema.optional(),
  sourceName: z.string().trim().min(1).max(255).optional(),
  sourceUrl: z.string().trim().min(1).max(2048).optional(),
})

const notesStateSchema = z.object({
  notes: z.array(noteItemSchema).default([]),
  deletedNoteIds: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  sidebarWidth: z.number().int().min(180).max(800).default(240),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

const planElementSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(255),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const planStateSchema = z.object({
  elements: z.array(planElementSchema).default([]),
  deletedElementIds: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

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
  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) {
      try {
        const payload = await app.jwt.verify<AuthPayload>(token)
        const userId = payload?.userId
        if (userId) return BigInt(userId)
      } catch {
        // ignore invalid bearer token and fallback to cookie auth
      }
    }
  }

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
  updatedAt: Date
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
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeDailyEarning(row: {
  id: string
  dateKey: string
  projectName: string
  amountCents: number
  updatedAt: Date
}) {
  return {
    id: row.id,
    dateKey: row.dateKey,
    projectName: row.projectName,
    amount: row.amountCents / 100,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeSidebarState(row: {
  stories: Prisma.JsonValue
  boards: Prisma.JsonValue
  deletedStoryKeys: Prisma.JsonValue
  deletedSectionIds: Prisma.JsonValue
  deletedCardIds: Prisma.JsonValue
  sidebarWidth: number
  updatedAt?: Date | null
}) {
  const parsed = sidebarStateSchema.safeParse({
    stories: row.stories,
    boards: row.boards,
    deletedStoryKeys: row.deletedStoryKeys,
    deletedSectionIds: row.deletedSectionIds,
    deletedCardIds: row.deletedCardIds,
    sidebarWidth: row.sidebarWidth,
  })
  if (!parsed.success) {
    return {
      stories: [],
      boards: {},
      deletedStoryKeys: {},
      deletedSectionIds: {},
      deletedCardIds: {},
      sidebarWidth: 240,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  }
  return {
    ...parsed.data,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

function serializeNotesState(row: {
  notes: Prisma.JsonValue
  deletedNoteIds: Prisma.JsonValue
  sidebarWidth: number
  updatedAt?: Date | null
}) {
  const parsed = notesStateSchema.safeParse({
    notes: row.notes,
    deletedNoteIds: row.deletedNoteIds,
    sidebarWidth: row.sidebarWidth,
  })
  if (!parsed.success) {
    return {
      notes: [],
      deletedNoteIds: {},
      sidebarWidth: 240,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  }
  return {
    ...parsed.data,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}

function serializePlanState(row: {
  elements: Prisma.JsonValue
  deletedElementIds: Prisma.JsonValue
  updatedAt?: Date | null
}) {
  const parsed = planStateSchema.safeParse({
    elements: row.elements,
    deletedElementIds: row.deletedElementIds,
  })
  if (!parsed.success) {
    return {
      elements: [],
      deletedElementIds: {},
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  }
  return {
    ...parsed.data,
    updatedAt: row.updatedAt?.toISOString() ?? null,
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

    return { ok: true, user: serializeUser(user), token }
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
    token,
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
  if (
    patch.baseUpdatedAt &&
    existing.updatedAt.toISOString() !== patch.baseUpdatedAt
  ) {
    return reply.code(409).send({
      ok: false,
      error: 'Task conflict',
      task: serializeTask(existing),
    })
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (patch.sessionStartedAt) {
      const nowMs = BigInt(patch.sessionStartedAt)
      const runningTasks = await tx.task.findMany({
        where: {
          userId,
          id: { not: params.data.id },
          sessionStartedAtMs: { not: null },
        },
        select: {
          id: true,
          sessionSeconds: true,
          sessionStartedAtMs: true,
        },
      })

      await Promise.all(
        runningTasks.map((task) => {
          const startedAt = task.sessionStartedAtMs ?? nowMs
          const delta = Number((nowMs - startedAt) / BigInt(1000))
          return tx.task.update({
            where: { id: task.id },
            data: {
              sessionSeconds: task.sessionSeconds + Math.max(0, delta),
              sessionStartedAtMs: null,
            },
          })
        }),
      )
    }

    return tx.task.update({
      where: { id: params.data.id },
      data: updateData,
    })
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
  if (
    patch.baseUpdatedAt &&
    existing.updatedAt.toISOString() !== patch.baseUpdatedAt
  ) {
    return reply.code(409).send({
      ok: false,
      error: 'Earning conflict',
      earning: serializeDailyEarning(existing),
    })
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

app.get('/sidebar-state', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const row = await prisma.sidebarState.findUnique({
    where: { userId },
    select: {
      stories: true,
      boards: true,
      deletedStoryKeys: true,
      deletedSectionIds: true,
      deletedCardIds: true,
      sidebarWidth: true,
      updatedAt: true,
    },
  })

  if (!row) {
    return {
      ok: true,
      sidebar: {
        stories: [],
        boards: {},
        deletedStoryKeys: {},
        deletedSectionIds: {},
        deletedCardIds: {},
        sidebarWidth: 240,
        updatedAt: null,
      },
    }
  }

  return { ok: true, sidebar: serializeSidebarState(row) }
})

app.put('/sidebar-state', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const parsed = sidebarStateSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid sidebar payload' })
  }

  const state = parsed.data
  const existing = await prisma.sidebarState.findUnique({
    where: { userId },
    select: {
      stories: true,
      boards: true,
      deletedStoryKeys: true,
      deletedSectionIds: true,
      deletedCardIds: true,
      sidebarWidth: true,
      updatedAt: true,
    },
  })

  if (
    existing &&
    state.baseUpdatedAt &&
    existing.updatedAt.toISOString() !== state.baseUpdatedAt
  ) {
    return reply.code(409).send({
      ok: false,
      error: 'Sidebar state conflict',
      sidebar: serializeSidebarState(existing),
    })
  }

  const updated = await prisma.sidebarState.upsert({
    where: { userId },
    create: {
      userId,
      stories: state.stories as Prisma.InputJsonValue,
      boards: state.boards as Prisma.InputJsonValue,
      deletedStoryKeys: state.deletedStoryKeys as Prisma.InputJsonValue,
      deletedSectionIds: state.deletedSectionIds as Prisma.InputJsonValue,
      deletedCardIds: state.deletedCardIds as Prisma.InputJsonValue,
      sidebarWidth: state.sidebarWidth,
    },
    update: {
      stories: state.stories as Prisma.InputJsonValue,
      boards: state.boards as Prisma.InputJsonValue,
      deletedStoryKeys: state.deletedStoryKeys as Prisma.InputJsonValue,
      deletedSectionIds: state.deletedSectionIds as Prisma.InputJsonValue,
      deletedCardIds: state.deletedCardIds as Prisma.InputJsonValue,
      sidebarWidth: state.sidebarWidth,
    },
    select: {
      stories: true,
      boards: true,
      deletedStoryKeys: true,
      deletedSectionIds: true,
      deletedCardIds: true,
      sidebarWidth: true,
      updatedAt: true,
    },
  })

  return { ok: true, sidebar: serializeSidebarState(updated) }
})

app.get('/notes-state', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const row = await prisma.notesState.findUnique({
    where: { userId },
    select: {
      notes: true,
      deletedNoteIds: true,
      sidebarWidth: true,
      updatedAt: true,
    },
  })

  if (!row) {
    return {
      ok: true,
      notesState: {
        notes: [],
        deletedNoteIds: {},
        sidebarWidth: 240,
        updatedAt: null,
      },
    }
  }

  return { ok: true, notesState: serializeNotesState(row) }
})

app.put('/notes-state', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const parsed = notesStateSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid notes payload' })
  }

  const state = parsed.data
  const existing = await prisma.notesState.findUnique({
    where: { userId },
    select: {
      notes: true,
      deletedNoteIds: true,
      sidebarWidth: true,
      updatedAt: true,
    },
  })

  if (existing) {
    if (!state.baseUpdatedAt || existing.updatedAt.toISOString() !== state.baseUpdatedAt) {
      return reply.code(409).send({
        ok: false,
        error: 'Notes state conflict',
        notesState: serializeNotesState(existing),
      })
    }
  }

  const updated = await prisma.notesState.upsert({
    where: { userId },
    create: {
      userId,
      notes: state.notes as Prisma.InputJsonValue,
      deletedNoteIds: state.deletedNoteIds as Prisma.InputJsonValue,
      sidebarWidth: state.sidebarWidth,
    },
    update: {
      notes: state.notes as Prisma.InputJsonValue,
      deletedNoteIds: state.deletedNoteIds as Prisma.InputJsonValue,
      sidebarWidth: state.sidebarWidth,
    },
    select: {
      notes: true,
      deletedNoteIds: true,
      sidebarWidth: true,
      updatedAt: true,
    },
  })

  return { ok: true, notesState: serializeNotesState(updated) }
})

app.get('/plan-state', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const row = await prisma.planState.findUnique({
    where: { userId },
    select: {
      elements: true,
      deletedElementIds: true,
      updatedAt: true,
    },
  })

  if (!row) {
    return {
      ok: true,
      planState: {
        elements: [],
        deletedElementIds: {},
        updatedAt: null,
      },
    }
  }

  return { ok: true, planState: serializePlanState(row) }
})

app.put('/plan-state', async (request, reply) => {
  const userId = await getAuthUserId(request)
  if (!userId) {
    return reply.code(401).send({ ok: false, error: 'Unauthorized' })
  }

  const parsed = planStateSchema.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(422).send({ ok: false, error: 'Invalid plan payload' })
  }

  const state = parsed.data
  const existing = await prisma.planState.findUnique({
    where: { userId },
    select: {
      elements: true,
      deletedElementIds: true,
      updatedAt: true,
    },
  })

  if (existing) {
    if (!state.baseUpdatedAt || existing.updatedAt.toISOString() !== state.baseUpdatedAt) {
      return reply.code(409).send({
        ok: false,
        error: 'Plan state conflict',
        planState: serializePlanState(existing),
      })
    }
  }

  const updated = await prisma.planState.upsert({
    where: { userId },
    create: {
      userId,
      elements: state.elements as Prisma.InputJsonValue,
      deletedElementIds: state.deletedElementIds as Prisma.InputJsonValue,
    },
    update: {
      elements: state.elements as Prisma.InputJsonValue,
      deletedElementIds: state.deletedElementIds as Prisma.InputJsonValue,
    },
    select: {
      elements: true,
      deletedElementIds: true,
      updatedAt: true,
    },
  })

  return { ok: true, planState: serializePlanState(updated) }
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
