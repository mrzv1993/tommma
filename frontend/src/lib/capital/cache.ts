import Dexie, { type EntityTable } from 'dexie'
import type { Operation, OperationFilters, OperationPage, ReferenceData } from '@capital/contracts'

export interface CapitalSnapshot {
  page: OperationPage
  completed: Operation[]
  references: ReferenceData
  filters: OperationFilters
  savedAt: string
}
type Row = { key: string; value: unknown }
type Cache = Dexie & { metadata: EntityTable<Row, 'key'> }
export function createCapitalCache(owner: string) {
  if (!owner.trim()) throw new Error('Authenticated cache owner is required')
  const database = new Dexie(`tommma-capital-v1:${encodeURIComponent(owner)}`) as Cache
  database.version(1).stores({ metadata: 'key' })
  let active = true
  return {
    async save(snapshot: CapitalSnapshot) { if (active) await database.metadata.put({ key: 'snapshot', value: snapshot }) },
    async read(): Promise<CapitalSnapshot | null> {
      if (!active) return null
      const row = await database.metadata.get('snapshot')
      return active ? row?.value as CapitalSnapshot ?? null : null
    },
    async backupAt() { if (!active) return null; const row = await database.metadata.get('backup'); return active && typeof row?.value === 'string' ? row.value : null },
    async markBackup(value: string) { if (active) await database.metadata.put({ key: 'backup', value }) },
    close() { active = false; database.close() },
    async clear() { active = false; await database.delete() },
  }
}
