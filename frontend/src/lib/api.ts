export type SessionUser = {
  id: string | number
  nickname: string
  email: string
  emailVerifiedAt?: string | null
}

export type SidebarProjectStory = {
  key: string
  name: string
}

export type SidebarSection = {
  id: string
  boardId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

export type SidebarCard = {
  id: string
  sectionId: string
  title: string
  completed?: boolean
  position: number
  createdAt: string
  updatedAt: string
}

export type SidebarBoard = {
  sections: SidebarSection[]
  cards: SidebarCard[]
}

export type SidebarState = {
  stories: SidebarProjectStory[]
  boards: Record<string, SidebarBoard>
  deletedStoryKeys?: Record<string, number>
  deletedSectionIds?: Record<string, number>
  deletedCardIds?: Record<string, number>
  sidebarWidth: number
  updatedAt?: string | null
  baseUpdatedAt?: string | null
}

export type SourceType = 'book' | 'article' | 'video' | 'course' | 'podcast' | 'social' | 'other'

export type NoteStateItem = {
  id: string
  text: string
  createdAt: number
  updatedAt: number
  sourceType?: SourceType
  sourceName?: string
  sourceUrl?: string
}

export type NotesState = {
  notes: NoteStateItem[]
  deletedNoteIds?: Record<string, number>
  sidebarWidth: number
  updatedAt?: string | null
  baseUpdatedAt?: string | null
}

const API_URL = import.meta.env.VITE_API_URL || '/api'
const AUTH_TOKEN_STORAGE_KEY = 'tommma.auth.token.v1'

export class ApiRequestError extends Error {
  status: number
  payload: unknown

  constructor(message: string, status: number, payload: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.payload = payload
  }
}

function getAuthToken() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || ''
}

function setAuthToken(token: string) {
  if (typeof window === 'undefined') return
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token)
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json')
    ? ((await response.json()) as T)
    : ({} as T)

  if (!response.ok) {
    const message =
      (data as { error?: string } | undefined)?.error ||
      `Request failed with status ${response.status}`
    throw new ApiRequestError(message, response.status, data)
  }

  return data
}

export const api = {
  async health() {
    return request<{ ok: boolean }>('/health')
  },
  async session() {
    return request<{ ok: boolean; user: SessionUser | null }>('/auth/session')
  },
  async register(payload: { nickname: string; email: string; password: string }) {
    const result = await request<{ ok: boolean; user: SessionUser; token?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setAuthToken(result.token || '')
    return result
  },
  async login(payload: { login: string; password: string }) {
    const result = await request<{ ok: boolean; user: SessionUser; token?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setAuthToken(result.token || '')
    return result
  },
  async logout() {
    const result = await request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    setAuthToken('')
    return result
  },
  async getTasks() {
    return request<{ ok: boolean; tasks: Record<string, unknown>[] }>('/tasks')
  },
  async createTask(task: Record<string, unknown>) {
    return request<{ ok: boolean; task: Record<string, unknown> }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    })
  },
  async patchTask(taskId: string, patch: Record<string, unknown>) {
    return request<{ ok: boolean; task: Record<string, unknown> }>(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  },
  async deleteTask(taskId: string) {
    return request<{ ok: boolean }>(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      body: JSON.stringify({}),
    })
  },
  async getEarnings() {
    return request<{ ok: boolean; earnings: Record<string, unknown>[] }>('/earnings')
  },
  async createEarning(earning: Record<string, unknown>) {
    return request<{ ok: boolean; earning: Record<string, unknown> }>('/earnings', {
      method: 'POST',
      body: JSON.stringify(earning),
    })
  },
  async patchEarning(earningId: string, patch: Record<string, unknown>) {
    return request<{ ok: boolean; earning: Record<string, unknown> }>(
      `/earnings/${encodeURIComponent(earningId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
    )
  },
  async deleteEarning(earningId: string) {
    return request<{ ok: boolean }>(`/earnings/${encodeURIComponent(earningId)}`, {
      method: 'DELETE',
      body: JSON.stringify({}),
    })
  },
  async getSidebarState() {
    return request<{ ok: boolean; sidebar: SidebarState }>('/sidebar-state')
  },
  async putSidebarState(payload: SidebarState) {
    return request<{ ok: boolean; sidebar: SidebarState }>('/sidebar-state', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
  async getNotesState() {
    return request<{ ok: boolean; notesState: NotesState }>('/notes-state')
  },
  async putNotesState(payload: NotesState) {
    return request<{ ok: boolean; notesState: NotesState }>('/notes-state', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },
}
