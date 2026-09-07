import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

let instance = 0
async function browser(t: TestContext) {
  const names = ['window', 'Notification', 'localStorage', 'navigator']
  const original = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
  t.after(() => names.forEach((name, i) => {
    if (original[i]) Object.defineProperty(globalThis, name, original[i]!)
    else Reflect.deleteProperty(globalThis, name)
  }))
  let prompts = 0
  let requested: NotificationPermission = 'granted'
  const shown: { title: string; options: NotificationOptions }[] = []
  const stored = new Map<string, string>()
  class MockNotification {
    static permission: NotificationPermission = 'default'
    static async requestPermission() { prompts++; this.permission = requested; return requested }
    onshow?: () => void
    onerror?: () => void
    onclick?: () => void
    constructor(title: string, options: NotificationOptions) {
      shown.push({ title, options })
      queueMicrotask(() => this.onshow?.())
    }
    close() {}
  }
  const registration = { showNotification: async (title: string, options: NotificationOptions) => { shown.push({ title, options }) } }
  const navigator = { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } }
  const window = { isSecureContext: true, Notification: MockNotification, location: { origin: 'https://tommma.example' }, focus() {} }
  const globals = { window, Notification: MockNotification, navigator, localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) } }
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true })
  const module = await import(`../src/lib/web-focus-notifications.ts?test=${++instance}`) as typeof import('../src/lib/web-focus-notifications')
  return { module, window, navigator, registration, Notification: MockNotification, shown, stored, prompts: () => prompts, requestResult: (value: NotificationPermission) => { requested = value } }
}

test('разрешение запрашивается только при включении, выбор сохраняется и выключается', async t => {
  const b = await browser(t)
  const notice = b.module.focusLifeNotification('a', 'Задача', 900000)
  assert.equal(b.module.webNotificationState(), 'off')
  assert.equal(await b.module.showWebNotification(notice), 'off')
  assert.equal(b.prompts(), 0)
  assert.equal(await b.module.enableWebNotifications(), 'on')
  assert.equal(b.prompts(), 1)
  assert.equal(b.stored.get('tommma:web-focus-notifications:v1'), 'on')
  assert.equal(await b.module.showWebNotification(notice), 'shown')
  assert.equal(b.shown.length, 1)
  assert.equal(b.shown[0]!.options.tag, 'tommma-focus:a:900000')
  assert.match(b.shown[0]!.options.body!, /2-ю жизнь \(30 минут\)/)
  await b.module.enableWebNotifications()
  assert.equal(b.prompts(), 1)
  b.module.disableWebNotifications()
  assert.equal(await b.module.showWebNotification(notice), 'off')
  assert.equal(b.shown.length, 1)
})

test('отказ и закрытие запроса не включают уведомления и не вызывают повторных запросов', async t => {
  const b = await browser(t)
  b.requestResult('default')
  assert.equal(await b.module.enableWebNotifications(), 'off')
  b.requestResult('denied')
  assert.equal(await b.module.enableWebNotifications(), 'denied')
  assert.equal(await b.module.enableWebNotifications(), 'denied')
  assert.equal(b.prompts(), 2)
  assert.equal(b.shown.length, 0)
})

test('нет поддержки и небезопасный origin не вызывают запрос разрешения', async t => {
  const b = await browser(t)
  b.window.isSecureContext = false
  assert.equal(await b.module.enableWebNotifications(), 'unsupported')
  assert.equal(b.prompts(), 0)
  b.window.isSecureContext = true
  Reflect.deleteProperty(b.window, 'Notification')
  assert.equal(b.module.webNotificationState(), 'unsupported')
})

test('выключение во время ожидания worker отменяет отправку', async t => {
  const b = await browser(t)
  b.Notification.permission = 'granted'
  b.stored.set('tommma:web-focus-notifications:v1', 'on')
  let ready!: (value: typeof b.registration) => void
  b.navigator.serviceWorker.ready = new Promise(resolve => { ready = resolve })
  const showing = b.module.showWebNotification(b.module.focusLifeNotification('a', 'Задача', 2700000))
  b.module.disableWebNotifications()
  ready(b.registration)
  assert.equal(await showing, 'off')
  assert.equal(b.shown.length, 0)
})

test('при сбое service worker используется desktop Notification, окончание бюджета предлагает подзадачи', async t => {
  const b = await browser(t)
  b.registration.showNotification = async () => { throw new Error('SW unavailable') }
  await b.module.enableWebNotifications()
  const notice = b.module.focusLifeNotification('a', 'Задача', 5400000)
  assert.equal(await b.module.showWebNotification(notice), 'shown')
  assert.match(b.shown[0]!.options.body!, /90 минут.*подзадачи/)
  assert.match(notice.title, /3-я жизнь/)
})

test('ошибка обоих способов доставки возвращает failed, не исключение', async t => {
  const b = await browser(t)
  await b.module.enableWebNotifications()
  b.registration.showNotification = async () => { throw new Error('denied') }
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: class {
    static permission = 'granted'
    constructor() { throw new Error('unsupported') }
  } })
  assert.equal(await b.module.showWebNotification(b.module.focusLifeNotification('a', 'Задача', 900000)), 'failed')
})

test('клик по системному уведомлению возвращает в Tommma без запуска таймера', async () => {
  const handlers = new Map<string, (event: unknown) => void>()
  let focused = 0
  let opened = ''
  let closed = 0
  let windows = [{ url: 'https://tommma.example/', focus: async () => { focused++ } }]
  runInNewContext(readFileSync(new URL('../public/focus-notifications-sw.js', import.meta.url), 'utf8'), {
    URL,
    self: { location: { origin: 'https://tommma.example' }, addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn), clients: { matchAll: async () => windows, openWindow: async (url: string) => { opened = url } } },
  })
  assert.equal(handlers.has('fetch'), false, 'Notification worker must not intercept app/API requests')
  let pending: Promise<void> | undefined
  const click = () => handlers.get('notificationclick')!({ notification: { close: () => { closed++ } }, waitUntil: (promise: Promise<void>) => { pending = promise } })
  click(); await pending
  assert.equal(focused, 1)
  assert.equal(opened, '')
  windows = []
  click(); await pending
  assert.equal(opened, '/')
  assert.equal(closed, 2)
})
