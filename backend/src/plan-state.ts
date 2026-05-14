import type { Prisma } from '@prisma/client'
import { z } from 'zod'

export type PlanElementState = {
  id: string
  title: string
  note?: string
  completed: boolean
  createdAt: number
  updatedAt: number
  children?: PlanElementState[]
}

export type PlanSheetState = {
  id: string
  title: string
  elements: PlanElementState[]
  deletedElementIds: Record<string, number>
  nextStepTaskIds: string[]
  createdAt: number
  updatedAt: number
}

export type PlanState = {
  elements: PlanElementState[]
  deletedElementIds: Record<string, number>
  sheets: PlanSheetState[]
  activeSheetId?: string | null
  baseUpdatedAt?: string | null
}

export const planElementSchema: z.ZodType<PlanElementState> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(255),
    note: z.string().max(5000).default(''),
    completed: z.boolean().default(false),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    children: z.array(planElementSchema).default([]),
  }),
)

export const planSheetSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(255),
  elements: z.array(planElementSchema).default([]),
  deletedElementIds: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  nextStepTaskIds: z.array(z.string().min(1).max(64)).default([]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export const planStateSchema = z.object({
  elements: z.array(planElementSchema).default([]),
  deletedElementIds: z.record(z.string().min(1).max(64), z.number().int().nonnegative()).default({}),
  sheets: z.array(planSheetSchema).default([]),
  activeSheetId: z.string().min(1).max(64).nullable().optional(),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

const storedPlanStateSchema = z.object({
  version: z.literal(2),
  sheets: z.array(planSheetSchema).default([]),
  activeSheetId: z.string().min(1).max(64).nullable().optional(),
})

export function buildStoredPlanElements(state: PlanState) {
  const sheets = state.sheets.length
    ? state.sheets
    : [
        {
          id: 'default-sheet',
          title: 'Лист 1',
          elements: state.elements,
          deletedElementIds: state.deletedElementIds,
          nextStepTaskIds: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]

  return {
    version: 2,
    sheets,
    activeSheetId: state.activeSheetId ?? sheets[0]?.id ?? null,
  }
}

export function serializePlanState(row: {
  elements: Prisma.JsonValue
  deletedElementIds: Prisma.JsonValue
  updatedAt?: Date | null
}) {
  const parsedStored = storedPlanStateSchema.safeParse(row.elements)
  if (parsedStored.success) {
    return {
      elements: [],
      deletedElementIds: {},
      sheets: parsedStored.data.sheets,
      activeSheetId: parsedStored.data.activeSheetId ?? parsedStored.data.sheets[0]?.id ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  }

  const parsed = planStateSchema.safeParse({
    elements: row.elements,
    deletedElementIds: row.deletedElementIds,
  })
  if (!parsed.success) {
    return {
      elements: [],
      deletedElementIds: {},
      sheets: [],
      activeSheetId: null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    }
  }
  return {
    ...parsed.data,
    activeSheetId: parsed.data.activeSheetId ?? parsed.data.sheets[0]?.id ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}
