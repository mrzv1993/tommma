// The worker watches scheduling continuity independently of rendering. It measures
// durations with monotonic time; pulse count is never used to calculate work time.
let timer: ReturnType<typeof setTimeout> | undefined
let checkpointAt = performance.now()
let previousPulse = checkpointAt
let previousWall = Date.now()
let uncertain = false
function pulse() {
  const now = performance.now()
  const wall = Date.now()
  const gap = now - previousPulse
  if (gap > 2500 || Math.abs(wall - previousWall - gap) > 1000) uncertain = true
  previousPulse = now
  previousWall = wall
  if (uncertain || now - checkpointAt >= 5000) {
    self.postMessage({ elapsedMs: uncertain ? 15001 : now - checkpointAt, sentAt: wall })
    checkpointAt = now
  } else {
    timer = setTimeout(pulse, 1000)
  }
}
self.onmessage = (event: MessageEvent<'start' | 'next' | 'stop'>) => {
  clearTimeout(timer)
  if (event.data === 'stop') return
  if (event.data === 'start') {
    checkpointAt = previousPulse = performance.now()
    previousWall = Date.now()
    uncertain = false
  }
  timer = setTimeout(pulse, 1000)
}
