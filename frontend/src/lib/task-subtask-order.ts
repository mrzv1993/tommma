export type SubtaskMove = { childId: string; targetId: string; position: 'before' | 'after' }

export function compareSubtasks(a: { id: string; priorityRank: number; createdAt: number }, b: { id: string; priorityRank: number; createdAt: number }) {
  return a.priorityRank - b.priorityRank || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

export function moveSubtaskIds(ids: string[], move: SubtaskMove): string[] {
  if (move.childId === move.targetId || !ids.includes(move.childId) || !ids.includes(move.targetId)) return ids
  const ordered = ids.filter(id => id !== move.childId)
  ordered.splice(ordered.indexOf(move.targetId) + (move.position === 'after' ? 1 : 0), 0, move.childId)
  return ordered
}
