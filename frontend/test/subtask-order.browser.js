// Run via playwright-cli run-code --filename against the active mdev preview.
// Mounts real components and app state; intercepts every API request with fixtures.
async (page) => {
  const origin = await page.evaluate(() => location.origin)
  const check = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)}`)
  }
  const fixture = (id, extra = {}) => ({
    id, title: id, column: 'todo', dateKey: '2026-09-09', recurrence: 'none', recurrenceParentId: null,
    completed: false, createdAt: 1, subtasks: [], parentTaskId: null, isContainer: false,
    doneWhen: '', workSummary: '', focusSpentMs: 0, focusHeartbeatAt: null,
    actualSeconds: 0, sessionSeconds: 0, sessionStartedAt: null, priorityGroup: null,
    priorityRank: 0, priorityImportance: 0, priorityUrgency: 0, priorityOverdue: 0,
    deletedAt: null, updatedAt: '2026-09-09T00:00:00.000Z', ...extra,
  })
  const tasks = [
    fixture('parent', { title: 'Доработки проекта', isContainer: true, priorityGroup: 1 }),
    fixture('first', { title: 'Первая подзадача', parentTaskId: 'parent', createdAt: 1 }),
    fixture('second', { title: 'Вторая подзадача', parentTaskId: 'parent', createdAt: 2 }),
    fixture('nested', { title: 'Вложенный блок', parentTaskId: 'parent', createdAt: 3, isContainer: true }),
    fixture('nested-first', { title: 'Вложенная первая', parentTaskId: 'nested', createdAt: 4 }),
    fixture('nested-second', { title: 'Вложенная вторая', parentTaskId: 'nested', createdAt: 5 }),
    fixture('other', { title: 'Другой проект', isContainer: true }),
    fixture('other-child', { parentTaskId: 'other' }),
  ]
  let requests = [], failNext = false, holdNext = false, release
  const sort = rows => rows.sort((a, b) => a.priorityRank - b.priorityRank || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  await page.route('**/api/**', async route => {
    if (route.request().url().endsWith('/tasks/other')) {
      const other = tasks.find(task => task.id === 'other')
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, task: other,
        tasks: [fixture('first', { parentTaskId: 'parent', focusSpentMs: 0 })] }) })
    }
    const match = route.request().url().match(/\/tasks\/([^/]+)\/subtasks\/order$/)
    if (!match) return route.abort()
    const move = route.request().postDataJSON()
    requests.push(move)
    if (holdNext) {
      holdNext = false
      await new Promise(resolve => { release = resolve })
    }
    if (failNext) {
      failNext = false
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Не удалось сохранить порядок. Попробуй ещё раз.' }) })
    }
    const ordered = sort(tasks.filter(task => task.parentTaskId === match[1])).filter(task => task.id !== move.childId)
    const child = tasks.find(task => task.id === move.childId)
    ordered.splice(ordered.findIndex(task => task.id === move.targetId) + (move.position === 'after' ? 1 : 0), 0, child)
    ordered.forEach((task, index) => { task.priorityRank = (index - ordered.length) * 1024; task.updatedAt = new Date().toISOString() })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, order: ordered.map(({ id, priorityRank, updatedAt }) => ({ id, priorityRank, updatedAt })) }) })
  })
  await page.route(`${origin}/subtask-order-regression`, route => route.fulfill({ contentType: 'text/html', body: '<div id="test-root"></div>' }))
  const mount = () => page.evaluate(async tasks => {
    const { createApp, h } = await import('/node_modules/.vite/deps/vue.js')
    const { useAppState } = await import('/src/lib/app-state.ts')
    const { provideTaskFocus } = await import('/src/app/task-focus-context.ts')
    const { default: PrioritiesSection } = await import('/src/components/sections/PrioritiesSection.vue')
    await import('/src/assets/index.css')
    await import('/src/app/AppRoot.css')
    const noop = async () => {}
    window.orderApp = createApp({ setup() {
      const board = useAppState()
      window.orderBoard = board
      board.state.value.tasks = tasks
      provideTaskFocus(board)
      return () => h('main', { class: 'screen' }, h(PrioritiesSection, {
        groups: [{ id: 1, limit: 1, tasks: board.state.value.tasks.filter(task => task.id === 'parent') }],
        inboxTasks: board.state.value.tasks.filter(task => task.id === 'other'),
        completedTasks: [], trashedTasks: [], addTask: noop, moveTask: noop, adjustScore: noop,
        removeTask: noop, completeTask: noop, restoreTask: noop, restoreDeletedTask: noop, updateTaskTitle: noop,
      }))
    } })
    window.orderApp.mount('#test-root')
  }, tasks)
  await page.setViewportSize({ width: 1050, height: 934 })
  await page.goto(`${origin}/subtask-order-regression`)
  await mount()
  console.log(await page.locator('body').ariaSnapshot())
  const root = page.locator('#priority-subtasks-parent')
  const order = () => root.locator(':scope > ul > li').evaluateAll(items => items.map(item => item.dataset.subtaskId))
  const handle = id => page.locator(`[data-subtask-id="${id}"] > .subtask-row > .subtask-drag-handle`)
  const row = id => page.locator(`[data-subtask-id="${id}"] > .subtask-row`)
  const saved = async () => {
    await root.locator(':scope > ul').getAttribute('aria-busy').then(async busy => {
      if (busy === 'true') await page.waitForFunction(() => document.querySelector('#priority-subtasks-parent > ul')?.getAttribute('aria-busy') === 'false')
    })
  }
  const drag = async (from, to, position = 'before') => {
    const a = await handle(from).boundingBox(), b = await row(to).boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 70, b.y + (position === 'before' ? 4 : b.height - 4), { steps: 8 })
    await page.mouse.up()
  }
  check(await order(), ['first', 'second', 'nested'], 'Initial creation order')
  check(await root.locator(':scope > ul').evaluate(el => getComputedStyle(el).borderLeftWidth), '0px', 'List line removed')
  check(await root.locator(':scope > .add-child-form').evaluate(el => getComputedStyle(el).borderLeftWidth), '0px', 'Form line removed')
  const geometry = await row('first').evaluate(el => {
    const h = el.querySelector('button').getBoundingClientRect(), c = el.querySelector('input').getBoundingClientRect()
    return h.right <= c.left
  })
  check(geometry, true, 'Handle is left of checkbox')
  // A title is not a drag handle, nor does a click on the grip reorder.
  const a = await row('first').boundingBox(), b = await row('nested').boundingBox()
  await page.mouse.move(a.x + 130, a.y + 10); await page.mouse.down()
  await page.mouse.move(b.x + 130, b.y + 10, { steps: 8 }); await page.mouse.up()
  await handle('first').click()
  check(requests.length, 0, 'Drag starts only on the handle after a movement threshold')
  holdNext = true
  await drag('nested', 'first')
  await page.waitForFunction(() => document.querySelector('#priority-subtasks-parent > ul')?.getAttribute('aria-busy') === 'true')
  check(await order(), ['nested', 'first', 'second'], 'Optimistic reorder before network response')
  check(await handle('first').isDisabled(), true, 'Block overlapping reorder while saving')
  await page.evaluate(() => { window.orderBoard.state.value.tasks.find(task => task.id === 'first').focusSpentMs = 4567 })
  release()
  await saved()
  check(await page.evaluate(() => window.orderBoard.state.value.tasks.find(task => task.id === 'first').focusSpentMs), 4567, 'Reorder response preserves timer progress')
  await page.evaluate(() => window.orderBoard.updateTaskTitle('other', 'Другой проект'))
  check(await order(), ['nested', 'first', 'second'], 'An older server snapshot cannot undo a saved reorder')
  check(await page.evaluate(() => window.orderBoard.state.value.tasks.find(task => task.id === 'first').focusSpentMs), 4567, 'An older snapshot cannot rewind timer progress')
  check(await page.evaluate(() => window.orderBoard.state.value.tasks.find(task => task.id === 'nested-first').parentTaskId), 'nested', 'Nested tree remains attached')
  await drag('nested', 'second', 'after'); await saved()
  check(await order(), ['first', 'second', 'nested'], 'Downward move after target')
  failNext = true
  await drag('second', 'first'); await saved()
  await page.getByRole('alert').waitFor()
  check(await order(), ['first', 'second', 'nested'], 'Failed write rolls order back')
  await handle('second').press('ArrowUp'); await saved()
  check(await order(), ['second', 'first', 'nested'], 'Keyboard retry persists')
  check(await root.locator(':scope > .split-error').count(), 0, 'Retry clears error')
  check(await handle('second').evaluate(el => el === document.activeElement), true, 'Keyboard focus remains on moved item')
  const count = requests.length
  await drag('first', 'other-child'); await drag('first', 'nested-first')
  check(requests.length, count, 'Other parents and depths reject drop')
  const from = await handle('first').boundingBox(), to = await row('second').boundingBox()
  await page.mouse.move(from.x + 10, from.y + 10); await page.mouse.down()
  await page.mouse.move(to.x + 70, to.y + 4, { steps: 5 }); await page.keyboard.press('Escape'); await page.mouse.up()
  check(requests.length, count, 'Escape cancels without saving')
  await page.screenshot({ path: 'output/playwright/subtask-order-desktop.png', fullPage: true })
  await page.reload(); await mount()
  check(await order(), ['second', 'first', 'nested'], 'Reload restores persisted order')
  await page.setViewportSize({ width: 390, height: 844 })
  await handle('nested-second').press('ArrowUp')
  await page.waitForFunction(() => document.querySelector('[data-subtask-id="nested"] ul')?.getAttribute('aria-busy') === 'false')
  check(await page.locator('[data-subtask-id="nested"] ul > li').evaluateAll(items => items.map(el => el.dataset.subtaskId)), ['nested-second', 'nested-first'], 'Nested siblings reorder independently')
  // Use real touch events, including browser pointer capture, on a mobile-sized viewport.
  const cdp = await page.context().newCDPSession(page)
  await handle('first').scrollIntoViewIfNeeded()
  const touchFrom = await handle('first').boundingBox(), touchTo = await row('second').boundingBox()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchFrom.x + 10, y: touchFrom.y + 10 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchTo.x + 70, y: touchTo.y + 4 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await saved()
  check(await order(), ['first', 'second', 'nested'], 'Touch handle reorder')
  await cdp.detach()
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile fits viewport')
  await page.screenshot({ path: 'output/playwright/subtask-order-mobile.png', fullPage: true })
  await page.evaluate(() => { window.orderBoard.state.value.tasks.find(task => task.id === 'parent').completed = true })
  check(await handle('first').isDisabled(), true, 'Completed parent blocks reorder')
  check(await handle('nested-first').isDisabled(), true, 'Completed ancestor blocks nested reorder')
  await page.evaluate(() => window.orderApp.unmount())
  console.log('PASS: handle-only mouse/touch, before/after, optimistic order, saved-data reload, error rollback/retry, keyboard, Escape, nested tree, parent boundaries, locked ancestors, timer preservation, no vertical lines, desktop/mobile')
}
