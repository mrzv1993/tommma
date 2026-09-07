export const LIFE_ENDS_MS = [900_000, 2_700_000, 5_400_000]
export const FOCUS_BUDGET_MS = 5_400_000
export const FOCUS_LEASE_MS = 15_000
export const livesLeft = (spentMs: number) => LIFE_ENDS_MS.filter(end => spentMs < end).length
export function lifeRemainingMs(spentMs: number) {
  return Math.max(0, (LIFE_ENDS_MS.find(end => spentMs < end) ?? FOCUS_BUDGET_MS) - spentMs)
}
export function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export type FocusTask = { id: string; parentTaskId: string | null; actualSeconds: number; sessionSeconds: number; focusSpentMs: number }
export function totalTaskMs(tasks: FocusTask[], taskId: string): number {
  const children = new Map<string, FocusTask[]>()
  const byId = new Map(tasks.map(task => [task.id, task]))
  for (const task of tasks) if (task.parentTaskId) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) ?? []), task])
  const seen = new Set<string>()
  const queue = [taskId]
  let total = 0
  for (const id of queue) {
    if (seen.has(id)) continue
    seen.add(id)
    const task = byId.get(id)
    if (task) total += (task.actualSeconds + task.sessionSeconds) * 1000 + task.focusSpentMs
    queue.push(...(children.get(id) ?? []).map(child => child.id))
  }
  return total
}
