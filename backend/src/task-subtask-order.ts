import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { assertAncestorsOpen, FocusError, lockTaskUser } from './task-focus.js'
import { PRIORITY_RANK_STEP } from './priority-ranking.js'

export const subtaskMoveSchema = z.object({
  childId: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  position: z.enum(['before', 'after']),
})

export async function reorderSubtasks(prisma: PrismaClient, userId: bigint, parentId: string, move: z.infer<typeof subtaskMoveSchema>) {
  return prisma.$transaction(async tx => {
    await lockTaskUser(tx, userId)
    const parent = await tx.task.findFirst({ where: { id: parentId, userId, deletedAt: null } })
    if (!parent) throw new FocusError(404, 'Задача не найдена')
    if (parent.completed) throw new FocusError(409, 'Сначала открой родительскую задачу повторно')
    await assertAncestorsOpen(tx, parent)
    const children = await tx.task.findMany({
      where: { userId, parentTaskId: parentId, deletedAt: null },
      orderBy: [{ priorityRank: 'asc' }, { createdAtMs: 'asc' }, { id: 'asc' }],
    })
    const child = children.find(task => task.id === move.childId)
    if (!child || !children.some(task => task.id === move.targetId)) {
      throw new FocusError(404, 'Подзадачи должны принадлежать одной родительской задаче')
    }
    if (move.childId === move.targetId) return children
    const ordered = children.filter(task => task.id !== move.childId)
    const targetIndex = ordered.findIndex(task => task.id === move.targetId)
    ordered.splice(targetIndex + (move.position === 'after' ? 1 : 0), 0, child)
    if (ordered.every((task, index) => task.id === children[index]?.id)) return children
    // Children have no priority group. Negative ranks leave new children (rank 0)
    // at the end, including children created by older clients, without a migration.
    return Promise.all(ordered.map((task, index) => tx.task.update({
      where: { id: task.id }, data: { priorityRank: (index - ordered.length) * PRIORITY_RANK_STEP },
    })))
  })
}
