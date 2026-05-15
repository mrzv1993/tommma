import type { Prisma } from '@prisma/client'
import { z } from 'zod'

export const USER_NAV_SECTIONS = ['main', 'board', 'notes', 'plan'] as const

export type UserNavSection = (typeof USER_NAV_SECTIONS)[number]

export type UserPreferencesState = {
  navOrder: UserNavSection[]
  baseUpdatedAt?: string | null
}

const userNavSectionSchema = z.enum(USER_NAV_SECTIONS)

export const userPreferencesSchema = z.object({
  navOrder: z.array(userNavSectionSchema).default([...USER_NAV_SECTIONS]),
  baseUpdatedAt: z.string().datetime().nullable().optional(),
})

export function normalizeUserNavOrder(raw: unknown): UserNavSection[] {
  const seen = new Set<UserNavSection>()
  const order: UserNavSection[] = []
  const values = Array.isArray(raw) ? raw : []

  for (const value of values) {
    if (!USER_NAV_SECTIONS.includes(value as UserNavSection)) continue
    const section = value as UserNavSection
    if (seen.has(section)) continue
    seen.add(section)
    order.push(section)
  }

  for (const section of USER_NAV_SECTIONS) {
    if (!seen.has(section)) order.push(section)
  }

  return order
}

export function serializeUserPreferences(row: {
  navOrder: Prisma.JsonValue
  updatedAt?: Date | null
}) {
  return {
    navOrder: normalizeUserNavOrder(row.navOrder),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  }
}
