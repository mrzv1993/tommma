export type ProcessItem = {
  id: string
  title: string
  rank: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ProcessSnapshot = { ok: true; items: ProcessItem[] }
export type ProcessAction =
  | { type: 'create'; id: string; title: string }
  | { type: 'edit'; id: string; title: string; baseTitle: string }
  | { type: 'move'; id: string; targetIndex: number }
  | { type: 'delete' | 'restore'; id: string }
