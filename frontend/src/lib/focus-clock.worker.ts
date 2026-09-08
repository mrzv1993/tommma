// The server owns accounting. This worker only schedules refreshes and life-end feedback.
let timer: ReturnType<typeof setTimeout> | undefined
let lifeEndAt = Infinity
function schedule() {
  timer = setTimeout(() => {
    self.postMessage({ elapsedMs: 5000, sentAt: Date.now() })
  }, Math.max(50, Math.min(5000, lifeEndAt - Date.now())))
}
self.onmessage = (event: MessageEvent<{ type: 'start' | 'next' | 'stop'; remainingMs: number }>) => {
  clearTimeout(timer)
  if (event.data.type === 'stop') return
  lifeEndAt = Date.now() + Math.max(50, event.data.remainingMs)
  schedule()
}
