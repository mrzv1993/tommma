export type AppSection = 'main' | 'board' | 'notes' | 'plan'

export const DEFAULT_APP_NAV_ORDER: AppSection[] = ['main', 'board', 'notes', 'plan']

export function normalizeAppNavOrder(raw: readonly unknown[]): AppSection[] {
  const seen = new Set<AppSection>()
  const order: AppSection[] = []

  for (const value of raw) {
    if (!DEFAULT_APP_NAV_ORDER.includes(value as AppSection)) continue
    const section = value as AppSection
    if (seen.has(section)) continue
    seen.add(section)
    order.push(section)
  }

  for (const section of DEFAULT_APP_NAV_ORDER) {
    if (!seen.has(section)) order.push(section)
  }

  return order
}
