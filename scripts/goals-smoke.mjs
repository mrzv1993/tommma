import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function goalsSmoke(request, expectStatus, baseUrl) {
  const post = body => ({ method: 'POST', body: JSON.stringify(body) })
  const patch = body => ({ method: 'PATCH', body: JSON.stringify(body) })
  const beforeTasks = (await request('/tasks')).tasks
  const goalId = randomUUID()
  const path = `/goals/${goalId}`
  const getGoal = result => result.goals.find(goal => goal.id === goalId)
  await expectStatus('/goals', post({ id: goalId, title: ' ' }), 422)
  await expectStatus('/goals', post({ id: goalId, title: 'Invalid goal', userId: '1' }), 422)
  let created = await request('/goals', post({ id: goalId, title: 'Goal smoke' }))
  assert.equal(getGoal(created).priorityGroup, null)
  assert.equal('actualSeconds' in getGoal(created), false)
  assert.equal('parentTaskId' in getGoal(created), false)
  assert.equal('userId' in getGoal(created), false)
  const repeated = await request('/goals', post({ id: goalId, title: 'Goal smoke' }))
  assert.equal(repeated.goals.filter(goal => goal.id === goalId).length, 1)
  await expectStatus(path, patch({ title: 'Invalid timer', actualSeconds: 1, baseUpdatedAt: getGoal(created).updatedAt }), 422)
  await expectStatus(`${path}/priority-score`, patch({ field: 'importance', delta: 10 }), 422)
  await request(`${path}/priority-score`, patch({ field: 'importance', delta: 1 }))
  await expectStatus(path, patch({ title: 'Stale title', baseUpdatedAt: getGoal(created).updatedAt }), 409)
  // Concurrent relative clicks are serialized per user and never lose increments.
  await Promise.all(Array.from({ length: 12 }, () => request(`${path}/priority-score`, patch({ field: 'importance', delta: 1 }))))
  created = await request('/goals')
  assert.equal(getGoal(created).priorityImportance, 9)
  assert.equal(getGoal(created).priorityGroup, 1)
  let result = await request(path, patch({ title: 'Updated goal', baseUpdatedAt: getGoal(created).updatedAt }))
  assert.equal(getGoal(result).title, 'Updated goal')
  result = await request(path, patch({ completed: true, baseUpdatedAt: getGoal(result).updatedAt }))
  assert.equal(getGoal(result).completed, true)
  assert.ok(getGoal(result).completedAt)
  await expectStatus(`${path}/priority-score`, patch({ field: 'urgency', delta: 1 }), 409)
  result = await request(path, patch({ completed: false, baseUpdatedAt: getGoal(result).updatedAt }))
  assert.equal(getGoal(result).priorityGroup, null)
  assert.equal(getGoal(result).completedAt, null)
  assert.equal(getGoal(result).priorityImportance, 9)
  result = await request(path, { method: 'DELETE', body: '{}' })
  assert.ok(getGoal(result).deletedAt)
  await expectStatus(path, patch({ title: 'Deleted edit', baseUpdatedAt: getGoal(result).updatedAt }), 404)
  result = await request(`${path}/restore`, post({}))
  assert.equal(getGoal(result).deletedAt, null)
  assert.equal(getGoal(result).priorityGroup, null)
  const secondId = randomUUID()
  await request('/goals', post({ id: secondId, title: 'Inbox second' }))
  result = await request(`${path}/priority`, patch({ targetIndex: 0 }))
  assert.ok(getGoal(result).priorityRank < result.goals.find(goal => goal.id === secondId).priorityRank)
  const baseTitle = getGoal(result).title
  const baseUpdatedAt = getGoal(result).updatedAt
  await request(`${path}/priority-score`, patch({ field: 'urgency', delta: 1 }))
  result = await request(path, patch({ title: 'Title after scoring', baseTitle, baseUpdatedAt }))
  assert.equal(getGoal(result).title, 'Title after scoring', 'A score update does not conflict with title editing')
  await expectStatus(path, patch({ title: 'Overwrite newer title', baseTitle, baseUpdatedAt }), 409)
  await request(path, patch({ completed: true, baseUpdatedAt: getGoal(result).updatedAt }))

  const rankedIds = Array.from({ length: 46 }, () => randomUUID())
  await Promise.all(rankedIds.map(id => request('/goals', post({ id, title: 'Ranking limit fixture' }))))
  await Promise.all(rankedIds.map(id => request(`/goals/${id}/priority-score`, patch({ field: 'overdue', delta: 1 }))))
  result = await request('/goals')
  const rankedGoals = result.goals.filter(goal => rankedIds.includes(goal.id))
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => rankedGoals.filter(goal => goal.priorityGroup === index + 1).length), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(rankedGoals.filter(goal => goal.priorityGroup === null).length, 1, 'The 46th goal stays in Inbox')

  // Every route rejects unauthenticated requests and another owner's valid IDs.
  const routes = [
    ['/goals', {}], ['/goals', post({ id: goalId, title: 'Goal smoke' })],
    [path, patch({ title: ' чужая цель', baseUpdatedAt: getGoal(result).updatedAt })],
    [`${path}/priority-score`, patch({ field: 'importance', delta: 1 })],
    [`${path}/priority`, patch({ targetIndex: 0 })], [path, { method: 'DELETE', body: '{}' }], [`${path}/restore`, post({})],
  ]
  for (const [route, init] of routes) assert.equal((await fetch(`${baseUrl}${route}`, { ...init, headers: { 'content-type': 'application/json' } })).status, 401)
  const nickname = `g${randomUUID().replaceAll('-', '').slice(0, 22)}`
  const credentials = { nickname, email: `${nickname}@example.com`, password: 'GoalSmoke12345' }
  const registration = await fetch(`${baseUrl}/auth/register`, { ...post(credentials), headers: { 'content-type': 'application/json' } })
  assert.ok(registration.ok)
  const login = await fetch(`${baseUrl}/auth/login`, { ...post({ login: nickname, password: credentials.password }), headers: { 'content-type': 'application/json' } })
  const { token } = await login.json()
  assert.ok(token)
  for (const [route, init] of routes) {
    const response = await fetch(`${baseUrl}${route}`, { ...init, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` } })
    if (route === '/goals' && !init.method) assert.deepEqual((await response.json()).goals, [])
    else assert.equal(response.status, route === '/goals' ? 409 : 404)
  }
  assert.deepEqual((await request('/tasks')).tasks, beforeTasks, 'Goal operations never mutate or enter tasks')
  console.log('OK  Goals: CRUD, retry, validation, concurrent scoring, completion, trash, order, task isolation, all-route owner isolation')
}
