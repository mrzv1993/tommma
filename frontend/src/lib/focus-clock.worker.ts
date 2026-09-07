// The worker watches scheduling continuity independently of rendering. It measures
// durations with monotonic time; pulse count is never used to calculate work time.
let timer: ReturnType<typeof setTimeout> | undefined
let checkpointAt = performance.now()
let previousPulse = checkpointAt
let previousWall = Date.now()
let uncertain = false
let lifeEndAt = Infinity
function schedulePulse() {
  timer = setTimeout(pulse, Math.max(50, Math.min(1000, lifeEndAt - performance.now())))
}
function pulse() {
  const now = performance.now()
  const wall = Date.now()
  const gap = now - previousPulse
  if (gap > 2500 || Math.abs(wall - previousWall - gap) > 1000) uncertain = true
  previousPulse = now
  previousWall = wall
  if (uncertain || now - checkpointAt >= 5000 || now >= lifeEndAt) {
    self.postMessage({ elapsedMs: uncertain ? 15001 : now - checkpointAt, sentAt: wall })
    checkpointAt = now
  } else {
    schedulePulse()
  }
}
self.onmessage = (event: MessageEvent<{ type: 'start' | 'next' | 'stop'; remainingMs: number }>) => {
  clearTimeout(timer)
  if (event.data.type === 'stop') return
  lifeEndAt = performance.now() + Math.max(50, event.data.remainingMs)
  if (event.data.type === 'start') {
    checkpointAt = previousPulse = performance.now()
    previousWall = Date.now()
    uncertain = false
  }
  schedulePulse()
}
