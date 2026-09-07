import { FOCUS_BUDGET_MS, FOCUS_LEASE_MS } from './task-focus'

type View = { taskId: string; spentMs: number; startedAt: number | null; confirmedAt: number }
type Session = { taskId: string; id: string; sequence: number; boundaryAt: number; view: View }
type Action = 'start' | 'checkpoint' | 'pause'
type Options = {
  now: () => number
  uuid: () => string
  confirmedMs: (taskId: string) => number
  request: (taskId: string, action: Action, payload?: Record<string, unknown>) => Promise<{ sessionId?: string | null; running?: boolean }>
  changed: () => void
  clock: (running: boolean) => void
  remember: (session: { taskId: string; id: string } | null) => void
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

  function spent(view: View, now: number) {
    const elapsed = view.startedAt === null ? 0 : Math.max(0, Math.min(now, view.confirmedAt + FOCUS_LEASE_MS) - view.startedAt)
    return Math.min(FOCUS_BUDGET_MS, view.spentMs + elapsed)
  }
  function freeze(view: View, at: number) {
    view.spentMs = spent(view, at)
    view.startedAt = null
    if (active === view) active = null
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
      settle(view)
      options.error()
      throw error
    })
    tail = result.catch(() => {})
    return result
  }
  async function save(current: Session, at: number, pause: boolean, uncertain = false) {
    const result = await options.request(current.taskId, 'checkpoint', {
      sessionId: current.id,
      sequence: ++current.sequence,
      elapsedMs: uncertain ? FOCUS_LEASE_MS + 1 : Math.max(0, at - current.boundaryAt),
      pause,
    }).catch(error => {
      if (session === current) session = null
      if (active === current.view) options.clock(false)
      settle(current.view)
      throw error
    })
    current.boundaryAt = at
    if (!result.running) {
      if (session === current) session = null
      options.remember(null)
      if (active === current.view) options.clock(false)
      settle(current.view)
    } else if (current.view.startedAt !== null) {
      current.view.spentMs = options.confirmedMs(current.taskId)
      current.view.startedAt = at
      current.view.confirmedAt = options.now()
      options.changed()
    }
  }

  function start(taskId: string) {
    const at = options.now()
    const previous = active
    const base = views.get(taskId)
    const view: View = { taskId, spentMs: base ? spent(base, at) : options.confirmedMs(taskId), startedAt: at, confirmedAt: at }
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
      options.remember({ taskId, id })
      const result = await options.request(taskId, 'start', { sessionId: id })
      if (!result.sessionId) { options.remember(null); settle(view); return }
      if (generation !== epoch || options.now() - boundaryAt > FOCUS_LEASE_MS) {
        await options.request(taskId, 'pause', { sessionId: id })
        options.remember(null)
        settle(view)
        if (generation === epoch) options.error()
        return
      }
      session = { taskId, id: result.sessionId, sequence: 0, boundaryAt, view }
      if (active === view) {
        view.confirmedAt = options.now()
        options.changed()
        options.clock(true)
      }
    })
  }

  function pause(taskId: string) {
    const at = options.now()
    const view = views.get(taskId) ?? { taskId, spentMs: options.confirmedMs(taskId), startedAt: null, confirmedAt: at }
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

  function checkpoint(at: number, uncertain: boolean) {
    const current = session
    if (!current || active !== current.view) return Promise.resolve()
    if (uncertain) {
      options.clock(false)
      freeze(current.view, at)
      options.changed()
    }
    return enqueue(current.view, async () => {
      if (session !== current) return
      await save(current, at, uncertain, uncertain)
      if (active === current.view) options.clock(true)
    })
  }

  function suspend() {
    epoch++
    options.clock(false)
    if (active) freeze(active, options.now())
    const current = session
    session = null
    options.changed()
    if (current) {
      options.remember(current)
      void options.request(current.taskId, 'pause', { sessionId: current.id }).catch(() => {})
    }
  }

  return {
    start, pause, checkpoint, suspend,
    hasView: (taskId: string) => views.has(taskId),
    activeTaskId: (now: number) => active && now - active.confirmedAt <= FOCUS_LEASE_MS && spent(active, now) < FOCUS_BUDGET_MS ? active.taskId : null,
    spentMs: (taskId: string, now: number) => { const view = views.get(taskId); return view ? spent(view, now) : options.confirmedMs(taskId) },
    // Called only after a fresh load without concurrent writes. Keep the owned
    // running projection, and let paused tasks reflect other clients again.
    refreshed: () => { for (const [id, view] of views) if (view !== active) views.delete(id); options.changed() },
  }
}
