// Run against an active mdev preview with playwright-cli run-code --filename.
// Mount the real component with synthetic tasks; never call the production API.
async (page) => {
  const origin = await page.evaluate(() => location.origin)
  await page.route('**/api/**', route => route.abort())
  await page.route(`${origin}/highlight-regression`, route => route.fulfill({
    contentType: 'text/html', body: '<div id="highlight-test"></div>',
  }))
  await page.goto(`${origin}/highlight-regression`)
  await page.clock.install({ time: '2026-09-06T00:00:00Z' })
  await page.clock.pauseAt('2026-09-06T00:00:01Z')
  await page.evaluate(async () => {
    const { createApp, h, ref } = await import('/node_modules/.vite/deps/vue.js')
    const { default: PrioritiesSection } = await import('/src/components/sections/PrioritiesSection.vue')
    const tasks = ref(['a', 'b'].map(id => ({
      id, title: `Task ${id}`, completed: false, subtasks: [],
      priorityImportance: 0, priorityUrgency: 0, priorityOverdue: 0,
    })))
    window.highlightTestPending = []
    window.highlightTestScrolls = []
    HTMLElement.prototype.scrollIntoView = function () {
      window.highlightTestScrolls.push(this.id)
    }
    const noop = async () => {}
    window.highlightTestApp = createApp({
      setup: () => () => h(PrioritiesSection, {
        groups: [{ id: 1, limit: 1, tasks: tasks.value.filter(task => task.priorityImportance > 0).slice(-1) }],
        inboxTasks: tasks.value.filter(task => task.priorityImportance === 0 || task !== tasks.value.filter(item => item.priorityImportance > 0).at(-1)),
        completedTasks: [], trashedTasks: [], addTask: noop, moveTask: noop,
        removeTask: noop, completeTask: noop, restoreTask: noop,
        restoreDeletedTask: noop, updateTaskTitle: noop,
        adjustScore: (id, field, delta) => {
          const task = tasks.value.find(item => item.id === id)
          task.priorityImportance += delta
          return new Promise((resolve, reject) => window.highlightTestPending.push({ id, resolve, reject }))
        },
      }),
    })
    window.highlightTestApp.mount('#highlight-test')
  })
  const highlighted = () => page.locator('.priority-task.score-updated').evaluateAll(rows => rows.map(row => row.id))
  const check = (actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)}`)
  }
  await page.getByRole('button', { name: 'Увеличить важность: Task a', exact: true }).click()
  check(await highlighted(), ['priority-task-a'], 'A must highlight before saving completes')
  check(await page.locator('#priority-task-b .score-stepper button:disabled').count(), 6, 'All other score buttons must be disabled after movement')
  check(await page.getByRole('button', { name: 'Увеличить важность: Task a', exact: true }).isEnabled(), true, 'Source task must remain editable')
  const replacedButton = await page.getByRole('button', { name: 'Увеличить важность: Task b', exact: true }).boundingBox()
  await page.mouse.click(replacedButton.x + replacedButton.width / 2, replacedButton.y + replacedButton.height / 2)
  check(await page.evaluate(() => window.highlightTestPending.length), 1, 'Accidental click must not change another task')
  check(await page.locator('#priority-task-b .priority-task-title').isEnabled(), true, 'Title editing must not be locked')
  await page.clock.runFor(599)
  check(await page.getByRole('button', { name: 'Увеличить важность: Task b', exact: true }).isDisabled(), true, 'Guard must last 600ms')
  await page.clock.runFor(1)
  check(await page.getByRole('button', { name: 'Увеличить важность: Task b', exact: true }).isEnabled(), true, 'Guard must expire while save is still pending')
  await page.getByRole('button', { name: 'Увеличить важность: Task b', exact: true }).click()
  check(await highlighted(), ['priority-task-b'], 'B must highlight after moving to group 1')
  await page.evaluate(() => window.highlightTestPending[0].resolve())
  check(await highlighted(), ['priority-task-b'], 'Late A response must not steal B highlight')
  check(await page.evaluate(() => window.highlightTestScrolls), ['priority-task-a', 'priority-task-b'], 'Late response must not scroll')
  await page.getByRole('button', { name: 'Увеличить важность: Task b', exact: true }).click()
  await page.evaluate(() => window.highlightTestPending[1].reject(new Error('Old save failed')))
  check(await highlighted(), ['priority-task-b'], 'Old failure must not clear newer highlight')
  await page.evaluate(() => window.highlightTestPending[2].reject(new Error('Latest save failed')))
  check(await highlighted(), [], 'Latest failure must clear highlight')
  await page.getByRole('button', { name: 'Уменьшить важность: Task b', exact: true }).click()
  check(await highlighted(), ['priority-task-b'], 'Minus must highlight the same task')
  await page.evaluate(() => window.highlightTestPending[3].resolve())
  await page.clock.runFor(1400)
  await page.waitForFunction(() => !document.querySelector('.score-updated'))

  // Same-position changes do not start a guard. Actual movements restart it.
  const plusB = page.getByRole('button', { name: 'Увеличить важность: Task b', exact: true })
  const minusB = page.getByRole('button', { name: 'Уменьшить важность: Task b', exact: true })
  const plusA = page.getByRole('button', { name: 'Увеличить важность: Task a', exact: true })
  await plusB.click()
  check(await plusA.isEnabled(), true, 'Same-position score change must not lock others')
  await minusB.click()
  await minusB.click()
  check(await plusA.isDisabled(), true, 'Moving source to Inbox must guard group buttons')
  await page.clock.runFor(400)
  await plusB.click()
  await page.clock.runFor(200)
  check(await plusA.isDisabled(), true, 'Repeated movement must restart guard')
  await plusB.click()
  await page.clock.runFor(400)
  check(await plusA.isEnabled(), true, 'Same-position click must not extend existing guard')
  await page.evaluate(() => window.highlightTestPending.at(-1).resolve())
  check(await plusA.isEnabled(), true, 'Late save must not restart guard')
  await minusB.click()
  await minusB.click()
  await page.evaluate(() => window.highlightTestApp.unmount())
  await page.clock.runFor(1400)
  await page.clock.resume()
  console.log('PASS: identity-bound highlight, 600ms reorder guard, blocked accidental clicks, timer restart, delayed saves, errors and unmount')
}
