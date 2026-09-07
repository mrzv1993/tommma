import { LIFE_ENDS_MS } from './task-focus'

export type WebNotificationState = 'unsupported' | 'denied' | 'off' | 'on'
export type FocusNotification = { title: string; body: string; tag: string }
const preferenceKey = 'tommma:web-focus-notifications:v1'
let enabledForPage = false
let registrationPromise: Promise<ServiceWorkerRegistration | null> | undefined

export function webNotificationState(): WebNotificationState {
  if (typeof window === 'undefined' || !window.isSecureContext || !('Notification' in window) ||
      Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  let enabled = enabledForPage
  try { enabled = localStorage.getItem(preferenceKey) === 'on' } catch { /* Private storage: keep the choice for this page. */ }
  return enabled && Notification.permission === 'granted' ? 'on' : 'off'
}

export function disableWebNotifications() {
  enabledForPage = false
  try { localStorage.removeItem(preferenceKey) } catch { /* Storage can be unavailable. */ }
}

async function notificationWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  if (!registrationPromise) {
    registrationPromise = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          navigator.serviceWorker.register('/focus-notifications-sw.js', { scope: '/' })
            .then(() => navigator.serviceWorker.ready),
          new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 5000) }),
        ])
      } catch { return null }
      finally { clearTimeout(timeout) }
    })()
  }
  const registration = await registrationPromise
  if (!registration) registrationPromise = undefined // Allow a retry after a temporary failure.
  return registration
}

// Call directly from a user click; never prompt on page load, Play, or timer expiry.
export async function enableWebNotifications(): Promise<WebNotificationState> {
  const state = webNotificationState()
  if (state === 'unsupported' || state === 'denied') return state
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  enabledForPage = true
  try { localStorage.setItem(preferenceKey, 'on') } catch { /* Keep the choice for this page. */ }
  await notificationWorker()
  return webNotificationState()
}

export async function showWebNotification(notice: FocusNotification): Promise<'shown' | 'off' | 'failed'> {
  if (webNotificationState() !== 'on') return 'off'
  const options: NotificationOptions = {
    body: notice.body, tag: notice.tag, icon: '/notification-icon.png',
    data: { url: window.location.origin + '/' },
  }
  try {
    const registration = await notificationWorker()
    if (webNotificationState() !== 'on') return 'off'
    if (registration) {
      try { await registration.showNotification(notice.title, options); return 'shown' }
      catch { /* Desktop browsers may still support a page notification. */ }
    }
    const notification = new Notification(notice.title, options)
    notification.onclick = () => { window.focus(); notification.close() }
    return await new Promise(resolve => {
      const timeout = setTimeout(() => resolve('failed'), 5000)
      notification.onshow = () => { clearTimeout(timeout); resolve('shown') }
      notification.onerror = () => { clearTimeout(timeout); resolve('failed') }
    })
  } catch { return 'failed' }
}

export function focusLifeNotification(taskId: string, title: string, lifeEndMs: number): FocusNotification {
  const life = LIFE_ENDS_MS.indexOf(lifeEndMs) + 1
  const next = life < 3
    ? `Таймер на паузе. Запусти ${life + 1}-ю жизнь (${life === 1 ? 30 : 45} минут), когда будешь готов.`
    : 'Все 90 минут израсходованы. Разбей оставшуюся работу на подзадачи.'
  return {
    title: `Tommma · ${life}-я жизнь завершена`,
    body: `«${title}». ${next}`,
    tag: `tommma-focus:${taskId}:${lifeEndMs}`,
  }
}
