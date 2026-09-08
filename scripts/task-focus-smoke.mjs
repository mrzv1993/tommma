import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
export async function taskFocusSmoke(request, expectStatus) {
  const post = body => ({ method: 'POST', body: JSON.stringify(body) })
  const patch = body => ({ method: 'PATCH', body: JSON.stringify(body) })
  const id = randomUUID()
  await request('/tasks', post({ id, title: 'Three lives smoke', column: 'todo', dateKey: '2026-09-07', recurrence: 'none', createdAt: Date.now() }))
  const path = `/tasks/${id}`
  // No condition field or detail form is required before the first start.
  const sessionId = randomUUID()
  await request(`${path}/focus/start`, post({ sessionId }))
  await request(`${path}/focus/start`, post({ sessionId }))
  const restored = await request('/tasks')
  assert.equal(restored.focusSession.id, sessionId, 'GET restores the ongoing life without starting another')
  assert.equal(restored.focusSession.lifeEndMs, 900000)
  await request(`${path}/focus/pause`, post({ sessionId, pausedAt: Date.now() }))
  assert.equal((await request('/tasks')).focusSession, null)
  const renamed = await request(path, patch({ title: 'Renamed focus smoke' }))
  assert.equal(renamed.task.doneWhen, '')
  await expectStatus(path, patch({ actualSeconds: 999999 }), 422)
  const children = [1, 2].map(n => ({ id: randomUUID(), title: `Child ${n}` }))
  await expectStatus(`${path}/focus/split`, post({ children }), 409)
  await expectStatus(`${path}/focus/split`, post({ children: [{ id: randomUUID(), title: '   ' }] }), 422)
  await request(path, patch({ completed: true }))
  const preserved = await request(path, patch({ title: 'Completed task renamed' }))
  assert.equal(preserved.task.completed, true)
  assert.equal(preserved.task.doneWhen, '')
  await request(path, patch({ completed: false }))
  await request(path, { method: 'DELETE', body: '{}' })
  console.log('OK  Three lives: immediate start, pause, no condition field, 90-minute split gate, completion and reopen')
}
