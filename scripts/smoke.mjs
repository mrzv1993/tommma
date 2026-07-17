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
  const overflowTaskId = randomId('priority-overflow')
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
  const initialPreferences = await request('/user-preferences', { method: 'GET' })
  const preferencesAfterUpdate = await request('/user-preferences', {
    method: 'PUT',
    body: JSON.stringify({
      navOrder: ['plan', 'main', 'board', 'priorities', 'notes'],
      baseUpdatedAt: initialPreferences.preferences?.updatedAt ?? null,
    }),
  })
  if (preferencesAfterUpdate.preferences?.navOrder?.[0] !== 'plan') {
    throw new Error('User nav preferences were not persisted')
  }
  console.log('OK  PUT/GET /user-preferences')

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
  const notesAfterCreate = await request('/notes-state', {
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
      baseUpdatedAt: notesAfterCreate.notesState?.updatedAt ?? null,
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
      priorityGroup: 1,
      priorityRank: Date.now(),
    }),
  })
  console.log('OK  POST /tasks')

  const secondPriorityTask = await request('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      id: overflowTaskId,
      title: 'Second priority task',
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
      priorityGroup: 1,
      priorityRank: Date.now(),
    }),
  })
  if (secondPriorityTask.task?.priorityGroup !== 1) {
    throw new Error('New task did not displace the previous task in group 1')
  }

  const importanceUpdate = await request(`/tasks/${encodeURIComponent(taskId)}/priority-score`, {
    method: 'PATCH',
    body: JSON.stringify({ importance: 1 }),
  })
  const importantTask = importanceUpdate.tasks?.find((task) => task.id === taskId)
  if (importantTask?.priorityImportance !== 1 || importantTask?.priorityGroup !== 1) {
    throw new Error('Importance score did not move task to group 1')
  }

  const urgencyUpdate = await request(`/tasks/${encodeURIComponent(overflowTaskId)}/priority-score`, {
    method: 'PATCH',
    body: JSON.stringify({ urgency: 1 }),
  })
  const urgentTask = urgencyUpdate.tasks?.find((task) => task.id === overflowTaskId)
  if (urgentTask?.priorityUrgency !== 1 || urgentTask?.priorityGroup !== 1) {
    throw new Error('Urgency tie-breaker did not move task to group 1')
  }
  console.log('OK  PATCH /tasks/:id/priority-score and automatic ranking')

  const movedToInbox = await request(`/tasks/${encodeURIComponent(taskId)}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ targetGroup: null, targetIndex: 0 }),
  })
  const movedToInboxTask = movedToInbox.tasks?.find((task) => task.id === taskId)
  if (movedToInboxTask?.priorityGroup !== null) {
    throw new Error('Priority task was not moved to Inbox')
  }
  if (movedToInboxTask?.priorityImportance !== 1 || movedToInboxTask?.priorityUrgency !== 0) {
    throw new Error('Priority task scores changed after moving to Inbox')
  }
  const movedBack = await request(`/tasks/${encodeURIComponent(taskId)}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ targetGroup: 1, targetIndex: 0 }),
  })
  const movedBackTask = movedBack.tasks?.find((task) => task.id === taskId)
  if (movedBackTask?.priorityGroup !== 1) {
    throw new Error('Priority task was not moved back to group 1')
  }
  console.log('OK  PATCH /tasks/:id/priority and automatic displacement')

  const resetPriorityScore = await request(`/tasks/${encodeURIComponent(taskId)}/priority-score`, {
    method: 'PATCH',
    body: JSON.stringify({ importance: 0, urgency: 0 }),
  })
  const resetPriorityTask = resetPriorityScore.tasks?.find((task) => task.id === taskId)
  if (
    resetPriorityTask?.priorityGroup !== null ||
    resetPriorityTask?.priorityImportance !== 0 ||
    resetPriorityTask?.priorityUrgency !== 0
  ) {
    throw new Error('Zero priority score did not return task to Inbox')
  }
  console.log('OK  PATCH /tasks/:id/priority-score returns zero-weight task to Inbox')

  const resetOverflowScore = await request(
    `/tasks/${encodeURIComponent(overflowTaskId)}/priority-score`,
    {
      method: 'PATCH',
      body: JSON.stringify({ importance: 0, urgency: 0 }),
    },
  )
  const resetOverflowTask = resetOverflowScore.tasks?.find((task) => task.id === overflowTaskId)
  if (resetOverflowTask?.priorityGroup !== null) {
    throw new Error('Second zero-weight task did not return to Inbox')
  }

  const reorderedInbox = await request(`/tasks/${encodeURIComponent(taskId)}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ targetGroup: null, targetIndex: 1 }),
  })
  const reorderedInboxIds = reorderedInbox.tasks
    ?.filter((task) => task.priorityGroup === null)
    .sort((left, right) => left.priorityRank - right.priorityRank)
    .map((task) => task.id)
  if (reorderedInboxIds?.[0] !== overflowTaskId || reorderedInboxIds?.[1] !== taskId) {
    throw new Error('Inbox task order was not persisted')
  }
  const reorderedTask = reorderedInbox.tasks?.find((task) => task.id === taskId)
  console.log('OK  PATCH /tasks/:id/priority reorders tasks inside Inbox')

  const patchedTask = await request(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: 'Smoke task updated',
      completed: true,
      baseUpdatedAt: reorderedTask.updatedAt,
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

  const deletedTask = await request(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    body: JSON.stringify({}),
  })
  if (!deletedTask.task?.deletedAt) {
    throw new Error('Deleted task did not receive a deletion timestamp')
  }
  const tasksAfterDelete = await request('/tasks', { method: 'GET' })
  if (tasksAfterDelete.tasks?.some((task) => task.id === taskId)) {
    throw new Error('Deleted task is still present in active tasks')
  }
  const trashAfterDelete = await request('/tasks/trash', { method: 'GET' })
  if (!trashAfterDelete.tasks?.some((task) => task.id === taskId)) {
    throw new Error('Deleted task was not added to trash')
  }

  const restoredTask = await request(`/tasks/${encodeURIComponent(taskId)}/restore`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  if (restoredTask.task?.deletedAt !== null) {
    throw new Error('Restored task still has a deletion timestamp')
  }
  const tasksAfterRestore = await request('/tasks', { method: 'GET' })
  if (!tasksAfterRestore.tasks?.some((task) => task.id === taskId)) {
    throw new Error('Restored task was not returned to active tasks')
  }
  console.log('OK  DELETE /tasks/:id, GET /tasks/trash and POST /tasks/:id/restore')

  await request(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE', body: JSON.stringify({}) })
  await request(`/tasks/${encodeURIComponent(overflowTaskId)}`, { method: 'DELETE', body: JSON.stringify({}) })

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
