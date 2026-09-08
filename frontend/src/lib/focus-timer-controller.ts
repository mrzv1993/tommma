import { lifeRemainingMs } from './task-focus'

export type FocusSnapshot = { taskId: string; id: string; sequence: number; spentMs: number; at: number; lifeEndMs: number }

type View = { taskId: string; spentMs: number; startedAt: number | null; confirmedAt: number; lifeEndMs: number }
type Session = { taskId: string; id: string; sequence: number; boundaryAt: number; view: View }
type Action = 'start' | 'checkpoint' | 'pause'
type Options = {
  now: () => number
  uuid: () => string
  confirmedMs: (taskId: string) => number
  request: (taskId: string, action: Action, payload?: Record<string, unknown>) => Promise<{ sessionId?: string | null; running?: boolean; focusSession?: FocusSnapshot | null }>
  changed: () => void
  clock: (running: boolean, remainingMs?: number) => void
  lifeEnded?: (taskId: string, lifeEndMs: number) => void
  error: () => void
}

// Clicks update the view synchronously. The queue preserves their order on the
// server; each checkpoint owns a time boundary, independent of response latency.
export function createFocusTimerController(options: Options) {
  const views = new Map<string, View>()
  let active: View | null = null
  let session: Session | null = null
  let tail = Promise.resolve()
  let epoch = 0
  let serverOffset = 0

  function spent(view: View, now: number) {
    const elapsed = view.startedAt === null ? 0 : Math.max(0, now - view.startedAt)
    return Math.min(view.lifeEndMs, view.spentMs + elapsed)
  }
  function freeze(view: View, at: number) {
    view.spentMs = spent(view, at)
    view.startedAt = null
    if (active === view) active = null
  }
  function continueClock(view: View) {
    options.clock(true, Math.max(0, view.lifeEndMs - spent(view, options.now())) || 5000)
  }
  function settle(view: View) {
    view.spentMs = options.confirmedMs(view.taskId)
    view.startedAt = null
    if (active === view) active = null
    options.changed()
  }
  function enqueue(view: View, operation: () => Promise<void>) {
    const result = tail.then(operation).catch(error => {
      if (session?.view === view) session = null
      if (active === view) options.clock(false)
      if (view.startedAt !== null) settle(view)
      options.error()
      throw error
    })
    tail = result.catch(() => {})
    return result
  }
  async function save(current: Session, at: number, pause: boolean) {
    const result = await options.request(current.taskId, 'checkpoint', {
      sessionId: current.id,
      sequence: current.sequence + 1,
      elapsedMs: Math.min(86_400_000, Math.max(0, at - current.boundaryAt)),
      pause,
      ...(pause ? { pausedAt: at + serverOffset } : {}),
    })
    current.sequence++
    current.boundaryAt = at
    if (!result.running) {
      const lifeEnded = !pause && active === current.view &&
        options.confirmedMs(current.taskId) >= current.view.lifeEndMs
      if (session === current) session = null
      if (active === current.view) options.clock(false)
      settle(current.view)
      // Notification failures must never turn a successful checkpoint into a timer error.
      if (lifeEnded) {
        try { options.lifeEnded?.(current.taskId, current.view.lifeEndMs) } catch { /* Optional feedback only. */ }
      }
    } else if (current.view.startedAt !== null) {
      current.view.spentMs = options.confirmedMs(current.taskId)
      current.view.startedAt = result.focusSession ? options.now() : at
      if (result.focusSession) serverOffset = result.focusSession.at - options.now()
      current.view.confirmedAt = options.now()
      options.changed()
    }
  }

  function start(taskId: string) {
    const at = options.now()
    const previous = active
    const base = views.get(taskId)
    const spentMs = base ? spent(base, at) : options.confirmedMs(taskId)
    // Keep this boundary for the whole run, including pending checkpoints.
    // Only an explicit new start may select the next life.
    const view: View = { taskId, spentMs, startedAt: at, confirmedAt: at, lifeEndMs: spentMs + lifeRemainingMs(spentMs) }
    if (previous) freeze(previous, at)
    options.clock(false)
    active = view
    views.set(taskId, view)
    options.changed()
    const generation = epoch
    return enqueue(view, async () => {
      if (generation !== epoch) return
      if (session) await save(session, at, true)
      const id = options.uuid()
      const boundaryAt = options.now()
      const result = await options.request(taskId, 'start', { sessionId: id })
      if (!result.sessionId) { settle(view); return }
      if (generation !== epoch) return
      session = { taskId, id: result.sessionId, sequence: 0, boundaryAt, view }
      if (result.focusSession && active === view) {
        view.spentMs = result.focusSession.spentMs
        view.startedAt = options.now()
        view.lifeEndMs = result.focusSession.lifeEndMs
        serverOffset = result.focusSession.at - options.now()
      }
      if (active === view) {
        view.confirmedAt = options.now()
        options.changed()
        continueClock(view)
      }
    })
  }

  function pause(taskId: string) {
    const at = options.now()
    const spentMs = options.confirmedMs(taskId)
    const view = views.get(taskId) ?? { taskId, spentMs, startedAt: null, confirmedAt: at, lifeEndMs: spentMs + lifeRemainingMs(spentMs) }
    views.set(taskId, view)
    if (active === view) options.clock(false)
    freeze(view, at)
    options.changed()
    return enqueue(view, async () => {
      if (session?.taskId === taskId) await save(session, at, true)
      else {
        await options.request(taskId, 'pause')
        settle(view)
      }
    })
  }

  function checkpoint(at: number, _uncertain = false) {
    const current = session
    if (!current || active !== current.view) return Promise.resolve()
    // Transport failures keep the same session and projection; the next pulse retries.
    const result = tail.then(async () => {
      if (session !== current) return
      try { await save(current, at, false) }
      catch { options.error() }
      if (active === current.view) continueClock(current.view)
    })
    tail = result.catch(() => {})
    return result
  }

  function suspend() {
    epoch++
    options.clock(false)
    if (active) freeze(active, options.now())
    session = null
    options.changed()
    // Unmounting/logging out never sends a pause to the server.
  }

  function restore(snapshot: FocusSnapshot | null) {
    if (!snapshot) {
      if (session) {
        const current = session
        const ended = active === current.view && options.confirmedMs(current.taskId) >= current.view.lifeEndMs
        options.clock(false); settle(current.view); session = null
        if (ended) { try { options.lifeEnded?.(current.taskId, current.view.lifeEndMs) } catch { /* Optional feedback. */ } }
      }
      return
    }
    const now = options.now()
    serverOffset = snapshot.at - now
    if (session && session.id !== snapshot.id) settle(session.view)
    const view: View = { taskId: snapshot.taskId, spentMs: snapshot.spentMs, startedAt: now, confirmedAt: now, lifeEndMs: snapshot.lifeEndMs }
    views.set(view.taskId, view)
    active = view
    session = { taskId: snapshot.taskId, id: snapshot.id, sequence: snapshot.sequence, boundaryAt: now, view }
    options.changed()
    continueClock(view)
  }

  return {
    start, pause, checkpoint, suspend, restore,
    hasView: (taskId: string) => views.has(taskId),
    activeTaskId: (now: number) => active && spent(active, now) < active.lifeEndMs ? active.taskId : null,
    spentMs: (taskId: string, now: number) => { const view = views.get(taskId); return view ? spent(view, now) : options.confirmedMs(taskId) },
    // Called only after a fresh load without concurrent writes. Keep the owned
    // running projection, and let paused tasks reflect other clients again.
    refreshed: () => { for (const [id, view] of views) if (view !== active) views.delete(id); options.changed() },
  }
}
