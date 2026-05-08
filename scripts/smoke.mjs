const BASE_URL = process.env.BASE_URL || 'http://localhost:8787'

const cookieJar = new Map()

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function randomNickname(prefix) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`.slice(0, 24)
}

function buildCookieHeader() {
  const pairs = []
  for (const [k, v] of cookieJar.entries()) pairs.push(`${k}=${v}`)
  return pairs.join('; ')
}

function storeSetCookie(headers) {
  const setCookie = headers.get('set-cookie')
  if (!setCookie) return
  const firstPart = setCookie.split(';')[0]
  const idx = firstPart.indexOf('=')
  if (idx === -1) return
  const name = firstPart.slice(0, idx).trim()
  const value = firstPart.slice(idx + 1).trim()
  if (!name) return
  if (value === '') {
    cookieJar.delete(name)
  } else {
    cookieJar.set(name, value)
  }
}

async function request(path, init = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(init.headers || {}),
  }

  const cookieHeader = buildCookieHeader()
  if (cookieHeader) headers.cookie = cookieHeader

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  })

  storeSetCookie(response.headers)

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : {}

  if (!response.ok) {
    const error = new Error(`[${response.status}] ${path} -> ${JSON.stringify(payload)}`)
    error.status = response.status
    error.payload = payload
    throw error
  }

  return payload
}

async function run() {
  const login = randomNickname('smoke')
  const email = `${login}@example.com`
  const password = 'Test12345'

  const taskId = randomId('task')
  const earningId = randomId('earning')
  const noteId = randomId('note')
  const storyKey = randomId('story')
  const sectionId = randomId('section')
  const cardId = randomId('card')
  const today = new Date().toISOString().slice(0, 10)

  console.log(`BASE_URL=${BASE_URL}`)

  await request('/health', { method: 'GET' })
  console.log('OK  /health')

  await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ nickname: login, email, password }),
  })
  console.log('OK  /auth/register')

  const session1 = await request('/auth/session', { method: 'GET' })
  if (!session1.user) throw new Error('Session missing after register')
  console.log('OK  /auth/session (logged in)')

  const initialSidebar = await request('/sidebar-state', { method: 'GET' })
  const sidebarAfterCreate = await request('/sidebar-state', {
    method: 'PUT',
    body: JSON.stringify({
      stories: [{ key: storyKey, name: 'Smoke project' }],
      boards: {
        [storyKey]: {
          sections: [
            {
              id: sectionId,
              boardId: storyKey,
              title: 'Smoke section',
              position: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          cards: [
            {
              id: cardId,
              sectionId,
              title: 'Smoke card',
              position: 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      },
      sidebarWidth: 260,
      baseUpdatedAt: initialSidebar.sidebar?.updatedAt ?? null,
    }),
  })
  const sidebarConflict = await request('/sidebar-state', {
    method: 'PUT',
    body: JSON.stringify({
      stories: [],
      boards: {},
      deletedStoryKeys: { [storyKey]: Date.now() },
      deletedSectionIds: { [sectionId]: Date.now() },
      deletedCardIds: { [cardId]: Date.now() },
      sidebarWidth: 260,
      baseUpdatedAt: sidebarAfterCreate.sidebar?.updatedAt ?? null,
    }),
  })
  if (!sidebarConflict.sidebar?.deletedStoryKeys?.[storyKey]) {
    throw new Error('Deleted sidebar story tombstone missing after PUT /sidebar-state')
  }
  console.log('OK  PUT /sidebar-state')

  const createdAt = Date.now()
  await request('/notes-state', {
    method: 'PUT',
    body: JSON.stringify({
      notes: [{ id: noteId, text: 'Smoke note', createdAt, updatedAt: createdAt }],
      deletedNoteIds: {},
      sidebarWidth: 260,
    }),
  })
  await request('/notes-state', {
    method: 'PUT',
    body: JSON.stringify({
      notes: [],
      deletedNoteIds: { [noteId]: Date.now() },
      sidebarWidth: 260,
    }),
  })
  const notesState = await request('/notes-state', { method: 'GET' })
  if (!notesState.notesState?.deletedNoteIds?.[noteId]) {
    throw new Error('Deleted note tombstone missing in GET /notes-state')
  }
  console.log('OK  PUT/GET /notes-state')

  const createdTask = await request('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      id: taskId,
      title: 'Smoke task',
      column: 'todo',
      dateKey: today,
      recurrenceParentId: null,
      recurrence: 'none',
      completed: false,
      createdAt: Date.now(),
      actualSeconds: 0,
      sessionSeconds: 0,
      sessionStartedAt: null,
      subtasks: [],
    }),
  })
  console.log('OK  POST /tasks')

  const patchedTask = await request(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Smoke task updated',
      completed: true,
      baseUpdatedAt: createdTask.task.updatedAt,
    }),
  })
  try {
    await request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Stale overwrite', baseUpdatedAt: createdTask.task.updatedAt }),
    })
    throw new Error('Expected stale task PATCH to fail with 409')
  } catch (error) {
    if (error.status !== 409 || !error.payload?.task) throw error
  }
  console.log('OK  PATCH /tasks/:id')

  const tasks = await request('/tasks', { method: 'GET' })
  if (!Array.isArray(tasks.tasks) || !tasks.tasks.some((t) => t.id === taskId)) {
    throw new Error('Created task not found in GET /tasks')
  }
  console.log('OK  GET /tasks')

  const createdEarning = await request('/earnings', {
    method: 'POST',
    body: JSON.stringify({
      id: earningId,
      dateKey: today,
      projectName: 'Smoke project',
      amount: 12.34,
    }),
  })
  console.log('OK  POST /earnings')

  await request(`/earnings/${encodeURIComponent(earningId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ amount: 56.78, baseUpdatedAt: createdEarning.earning.updatedAt }),
  })
  try {
    await request(`/earnings/${encodeURIComponent(earningId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 1.23, baseUpdatedAt: createdEarning.earning.updatedAt }),
    })
    throw new Error('Expected stale earning PATCH to fail with 409')
  } catch (error) {
    if (error.status !== 409 || !error.payload?.earning) throw error
  }
  console.log('OK  PATCH /earnings/:id')

  const earnings = await request('/earnings', { method: 'GET' })
  if (!Array.isArray(earnings.earnings) || !earnings.earnings.some((e) => e.id === earningId)) {
    throw new Error('Created earning not found in GET /earnings')
  }
  console.log('OK  GET /earnings')

  await request(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE', body: JSON.stringify({}) })
  console.log('OK  DELETE /tasks/:id')

  await request(`/earnings/${encodeURIComponent(earningId)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  })
  console.log('OK  DELETE /earnings/:id')

  await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) })
  console.log('OK  /auth/logout')

  const session2 = await request('/auth/session', { method: 'GET' })
  if (session2.user !== null) throw new Error('Session should be null after logout')
  console.log('OK  /auth/session (logged out)')

  console.log('Smoke test passed')
}

run().catch((error) => {
  console.error('Smoke test failed:', error.message)
  process.exit(1)
})
