// Notifications only: this worker does not cache pages or intercept API requests.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = windows.find(window => new URL(window.url).origin === self.location.origin)
    if (client) await client.focus()
    else await self.clients.openWindow('/')
  })())
})
