import type { DailyProjectEarning } from '@/lib/app-state'

export type DisplayEarning = DailyProjectEarning & {
  sourceEntryId: string | null
}

export type ProjectTaskItem = {
  id: string
  title: string
  completed: boolean
  createdAt: number
}

export type ProjectStoryItem = {
  key: string
  name: string
}

export type SectionItem = {
  id: string
  boardId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

export type CardItem = {
  id: string
  sectionId: string
  title: string
  completed: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export type ProjectBoardState = {
  sections: SectionItem[]
  cards: CardItem[]
}

export const ROOT_SECTION_PREFIX = '__root__'
export const ROOT_SECTION_INSERT_TARGET = '__root_insert__'

export const REMOVED_PROJECT_NAMES = new Set(['новый проект'])
export const EXPENSE_PROJECT_NAMES = new Set(['расход', 'расходы'])

export const PROJECT_TASKS_STORAGE_KEY = 'tommma.projectTasks.v1'
export const PROJECT_STORIES_STORAGE_KEY = 'tommma.projectStories.v1'
export const PROJECT_BOARDS_STORAGE_KEY = 'tommma.projectBoards.v1'
export const PROJECT_DELETED_STORIES_STORAGE_KEY = 'tommma.projectDeletedStories.v1'
export const PROJECT_DELETED_SECTIONS_STORAGE_KEY = 'tommma.projectDeletedSections.v1'
export const PROJECT_DELETED_CARDS_STORAGE_KEY = 'tommma.projectDeletedCards.v1'
export const PROJECT_SIDEBAR_WIDTH_STORAGE_KEY = 'tommma.projectSidebar.width.v1'

export const NOTES_STORAGE_KEY = 'tommma.notes.v1'
export const DELETED_NOTES_STORAGE_KEY = 'tommma.notes.deleted.v1'
export const NOTES_SIDEBAR_WIDTH_STORAGE_KEY = 'tommma.notes.sidebar.width.v1'
export const CLIENT_CACHE_OWNER_USER_ID_STORAGE_KEY = 'tommma.cache.owner.user.v1'

export const PROJECT_SIDEBAR_LEFT_OFFSET = 72
export const PROJECT_SIDEBAR_LEFT_OFFSET_COLLAPSED = 16
export const PROJECT_SIDEBAR_MIN_WIDTH = 220
export const PROJECT_SIDEBAR_MAX_WIDTH = 520

export function rootSectionId(projectKey: string) {
  return `${ROOT_SECTION_PREFIX}:${projectKey}`
}

export function normalizeProjectName(projectName: string) {
  return projectName.trim().toLowerCase()
}

export function isRemovedProject(projectName: string) {
  return REMOVED_PROJECT_NAMES.has(normalizeProjectName(projectName))
}

export function isExpenseProject(projectName: string) {
  return EXPENSE_PROJECT_NAMES.has(normalizeProjectName(projectName))
}

export function signedProjectAmount(projectName: string, amount: number) {
  return isExpenseProject(projectName) ? -Math.abs(amount) : amount
}

export function displayProjectTitle(projectName: string) {
  const value = projectName.trim()
  if (!value) return ''
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function projectLabelLetters(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return 'P'
  const parts = trimmed.split(/\s+/).slice(0, 2)
  return parts
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('')
    .slice(0, 2)
}
