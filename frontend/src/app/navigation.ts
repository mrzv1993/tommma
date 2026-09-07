export type AppSection = 'main' | 'board' | 'priorities' | 'notes' | 'plan' | 'statistics'
export type OrderedAppSection = Exclude<AppSection, 'statistics'>

export const DEFAULT_APP_NAV_ORDER: OrderedAppSection[] = ['main', 'board', 'priorities', 'notes', 'plan']

export function normalizeAppNavOrder(raw: readonly unknown[]): OrderedAppSection[] {
  const seen = new Set<OrderedAppSection>()
  const order: OrderedAppSection[] = []

  for (const value of raw) {
    if (!DEFAULT_APP_NAV_ORDER.includes(value as OrderedAppSection)) continue
    const section = value as OrderedAppSection
    if (seen.has(section)) continue
    seen.add(section)
    order.push(section)
  }

  for (const section of DEFAULT_APP_NAV_ORDER) {
    if (!seen.has(section)) order.push(section)
  }

  return order
}
