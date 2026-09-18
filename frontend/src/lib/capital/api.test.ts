import { afterEach, expect, it, vi } from 'vitest'
import { createCapitalApi } from './api'
const mock = vi.hoisted(() => ({ request: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/api', () => ({ request: mock.request, ApiRequestError: class extends Error {} }))
afterEach(() => vi.clearAllMocks())
it('sends valid JSON for bodyless actions through the existing Tommma transport', async () => {
  const controller = new AbortController(), api = createCapitalApi('23', controller.signal)
  await api.archiveOperation('operation'); await api.startOkxSync(); await api.startOkxWalletSync(); await api.backupCreated()
  expect(mock.request).toHaveBeenCalledTimes(4)
  for (const [, init] of mock.request.mock.calls) {
    expect(JSON.parse(init.body)).toEqual({})
    expect(init.headers['X-Capital-Owner']).toBe('23')
    expect(init.signal).toBe(controller.signal)
  }
})
it('does not issue an action after its user session is closed', async () => {
  const controller = new AbortController(), api = createCapitalApi('23', controller.signal)
  controller.abort()
  await expect(api.archiveOperation('operation')).rejects.toThrow('Сессия раздела закрыта')
  expect(mock.request).not.toHaveBeenCalled()
})
