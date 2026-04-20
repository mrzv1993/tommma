export type SessionUser = {
  id: string | number
  nickname: string
  email: string
  emailVerifiedAt?: string | null
}

const API_URL = import.meta.env.VITE_API_URL || '/api'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
    throw new Error(message)
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
    return request<{ ok: boolean; user: SessionUser }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  async login(payload: { login: string; password: string }) {
    return request<{ ok: boolean; user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },
  async logout() {
    return request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    })
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
}
