import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

export async function processSmoke(request, expectStatus, baseUrl) {
  const post = body => ({ method: 'POST', body: JSON.stringify(body) })
  const patch = body => ({ method: 'PATCH', body: JSON.stringify(body) })
  const beforeTasks = (await request('/tasks')).tasks
  const beforeGoals = (await request('/goals')).goals
  const id = randomUUID()
  const path = `/process-items/${id}`
  const item = snapshot => snapshot.items.find(row => row.id === id)
  const active = snapshot => snapshot.items.filter(row => !row.deletedAt)

  for (const title of ['', ' ', 'x'.repeat(256)]) await expectStatus('/process-items', post({ id, title }), 422)
  await expectStatus('/process-items', post({ id, title: 'Invalid', userId: '1' }), 422)
  const created = await request('/process-items', post({ id, title: '  Process smoke  ' }))
  assert.equal(item(created).title, 'Process smoke')
  assert.equal(item(created).deletedAt, null)
  for (const forbidden of ['userId', 'completed', 'priorityGroup', 'actualSeconds', 'focusSpentMs', 'subtasks']) assert.equal(forbidden in item(created), false)
  const repeated = await request('/process-items', post({ id, title: 'Process smoke' }))
  assert.equal(repeated.items.filter(row => row.id === id).length, 1)
  await expectStatus('/process-items', post({ id, title: 'Overwrite' }), 409)

  const otherIds = [randomUUID(), randomUUID()]
  for (const otherId of otherIds) await request('/process-items', post({ id: otherId, title: 'Order fixture' }))
  let result = await request('/process-items')
  assert.deepEqual(active(result).slice(0, 3).map(row => row.id), [...otherIds].reverse().concat(id))
  await request(`${path}/position`, patch({ targetIndex: 0 }))
  result = await request('/process-items')
  assert.equal(active(result)[0].id, id)
  await request(`${path}/position`, patch({ targetIndex: 1000 }))
  result = await request('/process-items')
  assert.equal(active(result).at(-1).id, id)
  for (const targetIndex of [-1, 0.5, '1']) await expectStatus(`${path}/position`, patch({ targetIndex }), 422)
  await expectStatus(`${path}/position`, patch({ targetIndex: 0, userId: '1' }), 422)

  // Reorder doesn't make a title stale; another rename does. Lost responses are retryable.
  await request(path, patch({ title: 'Renamed', baseTitle: item(created).title }))
  await request(path, patch({ title: 'Renamed', baseTitle: item(created).title }))
  await expectStatus(path, patch({ title: 'Lost update', baseTitle: item(created).title }), 409)
  await expectStatus(path, patch({ title: 'Invalid', baseTitle: 'Renamed', userId: '1' }), 422)
  await expectStatus(path, patch({ title: ' ', baseTitle: 'Renamed' }), 422)
  await expectStatus(path, patch({ title: 'Missing base' }), 422)
  await request(path, { method: 'DELETE', body: '{}' })
  await request(path, { method: 'DELETE', body: '{}' })
  result = await request('/process-items')
  assert.ok(item(result).deletedAt)
  assert.equal(active(result).some(row => row.id === id), false)
  await expectStatus(path, patch({ title: 'Trash edit', baseTitle: 'Renamed' }), 404)
  await expectStatus(`${path}/position`, patch({ targetIndex: 0 }), 404)
  await expectStatus('/process-items', post({ id, title: 'Renamed' }), 409)
  await expectStatus(`${path}/restore`, post({ userId: '1' }), 422)
  await request(`${path}/restore`, post({}))
  await request(`${path}/restore`, post({}))
  result = await request('/process-items')
  assert.equal(item(result).deletedAt, null)
  assert.equal(item(result).title, 'Renamed')
  await expectStatus(path, { method: 'DELETE', body: JSON.stringify({ userId: '1' }) }, 422)

  const concurrentIds = Array.from({ length: 4 }, () => randomUUID())
  await Promise.all(concurrentIds.map(id => request('/process-items', post({ id, title: 'Concurrent create' }))))
  await Promise.all(concurrentIds.map(id => request(`/process-items/${id}/position`, patch({ targetIndex: 0 }))))
  result = await request('/process-items')
  assert.equal(new Set(active(result).map(row => row.rank)).size, active(result).length)
  assert.ok(concurrentIds.every(id => active(result).some(row => row.id === id)))

  const routes = [
    ['/process-items', {}], ['/process-items', post({ id, title: 'Renamed' })],
    [path, patch({ title: 'Other owner', baseTitle: 'Renamed' })],
    [`${path}/position`, patch({ targetIndex: 0 })],
    [path, { method: 'DELETE', body: '{}' }], [`${path}/restore`, post({})],
  ]
  for (const [route, init] of routes) {
    for (const authorization of ['', 'Bearer invalid-token']) {
      const response = await fetch(`${baseUrl}${route}`, { ...init, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) } })
      assert.equal(response.status, 401)
    }
  }
  const nickname = `p${randomUUID().replaceAll('-', '').slice(0, 22)}`
  const credentials = { nickname, email: `${nickname}@example.com`, password: 'ProcessSmoke12345' }
  const registration = await fetch(`${baseUrl}/auth/register`, { ...post(credentials), headers: { 'content-type': 'application/json' } })
  assert.ok(registration.ok)
  const login = await fetch(`${baseUrl}/auth/login`, { ...post({ login: nickname, password: credentials.password }), headers: { 'content-type': 'application/json' } })
  const { token } = await login.json()
  assert.ok(token)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  for (const auth of [{ authorization: `Bearer ${token}` }, { cookie }]) {
    for (const [route, init] of routes) {
      const response = await fetch(`${baseUrl}${route}`, { ...init, headers: { 'content-type': 'application/json', ...auth } })
      if (route === '/process-items' && !init.method) assert.deepEqual((await response.json()).items, [])
      else assert.equal(response.status, route === '/process-items' ? 409 : 404)
    }
  }
  for (const [route, init] of routes.slice(2)) await expectStatus(route.replace(id, randomUUID()), init, 404)
  assert.deepEqual((await request('/process-items')).items, result.items, 'Rejected mutations never change the owner snapshot')
  assert.deepEqual((await request('/tasks')).tasks, beforeTasks, 'Process never changes tasks')
  assert.deepEqual((await request('/goals')).goals, beforeGoals, 'Process never changes goals')
  console.log('OK  Process: CRUD, retry, order, trash, conflicts, validation, concurrency, bearer/cookie ownership and task/goal isolation')
}
