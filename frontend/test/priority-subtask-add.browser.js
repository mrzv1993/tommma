// Run with playwright-cli run-code --filename against the active mdev preview.
// Real components, app state and API client; every API request is intercepted.
async (page) => {
  const origin = await page.evaluate(() => location.origin)
  const check = (actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)}`)
  }
  const fixture = (id, title, extra = {}) => ({
    id, title, column: 'todo', dateKey: '2026-09-08', recurrence: 'none', recurrenceParentId: null,
    completed: false, createdAt: Date.now(), subtasks: [], parentTaskId: null, isContainer: false,
    doneWhen: '', workSummary: '', focusSpentMs: 0, focusHeartbeatAt: null,
    actualSeconds: 0, sessionSeconds: 0, sessionStartedAt: null,
    priorityGroup: null, priorityRank: 0, priorityImportance: 0, priorityUrgency: 0, priorityOverdue: 0,
    deletedAt: null, updatedAt: null, ...extra,
  })
  const tasks = [
    fixture('parent', 'Доделать проект', { isContainer: true, focusSpentMs: 5400000, priorityGroup: 1 }),
    fixture('first', 'Первая подзадача', { parentTaskId: 'parent' }),
    fixture('nested', 'Вложенный блок', { parentTaskId: 'parent', isContainer: true, focusSpentMs: 5400000 }),
    fixture('empty', 'Пустой блок', { isContainer: true }),
    fixture('leaf', 'Обычная задача'),
  ]
  const requests = []
  const pending = []
  await page.route('**/api/**', async route => {
    const match = route.request().url().match(/\/api\/tasks\/([^/]+)\/focus\/split$/)
    if (!match) return route.abort()
    const payload = route.request().postDataJSON()
    requests.push({ parentId: match[1], ...payload })
    await new Promise(resolve => pending.push(async fail => {
      for (const child of payload.children) {
        if (!tasks.some(task => task.id === child.id)) tasks.push(fixture(child.id, child.title, { parentTaskId: match[1] }))
      }
      // A lost response after committing must be safe to retry with the same id.
      await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json',
        body: JSON.stringify(fail ? { error: 'Не удалось получить ответ. Повтори добавление.' } : { ok: true, tasks }) })
      resolve()
    }))
  })
  await page.route(`${origin}/subtask-regression`, route => route.fulfill({
    contentType: 'text/html', body: '<div id="subtask-test"></div>',
  }))
  const mount = async () => page.evaluate(async tasks => {
    const { createApp, h, ref } = await import('/node_modules/.vite/deps/vue.js')
    const { useAppState } = await import('/src/lib/app-state.ts')
    const { provideTaskFocus } = await import('/src/app/task-focus-context.ts')
    const { default: PrioritiesSection } = await import('/src/components/sections/PrioritiesSection.vue')
    const { default: AppSidebar } = await import('/src/components/navigation/AppSidebar.vue')
    const { default: TaskStatisticsSection } = await import('/src/components/sections/TaskStatisticsSection.vue')
    await import('/src/assets/index.css')
    await import('/src/app/AppRoot.css')
    const noop = async () => {}
    window.subtaskTestApp = createApp({ setup() {
      const board = useAppState()
      window.subtaskTestBoard = board
      board.state.value.tasks = tasks
      provideTaskFocus(board)
      const active = ref('priorities')
      return () => h('main', { class: 'screen' }, [
        h(AppSidebar, { activeSection: active.value, sidebarOpen: false, collapsed: false,
          isDesktopRuntime: false, navOrder: ['priorities', 'main', 'board', 'notes', 'plan', 'statistics'],
          updaterBusy: false, user: null, busy: false, onSelectSection: value => { active.value = value } }),
        active.value === 'priorities' ? h(PrioritiesSection, {
          groups: [{ id: 1, limit: 1, tasks: board.state.value.tasks.filter(task => task.id === 'parent') }],
          inboxTasks: board.state.value.tasks.filter(task => !task.parentTaskId && task.id !== 'parent'),
          completedTasks: [], trashedTasks: [], addTask: noop, moveTask: noop, adjustScore: noop,
          removeTask: noop, completeTask: noop, restoreTask: noop, restoreDeletedTask: noop, updateTaskTitle: noop,
          onOpenStatistics: () => { active.value = 'statistics' },
        }) : h(TaskStatisticsSection),
      ])
    } })
    window.subtaskTestApp.mount('#subtask-test')
  }, tasks)
  await page.setViewportSize({ width: 1327, height: 934 })
  await page.goto(`${origin}/subtask-regression`)
  await mount()
  console.log(await page.locator('body').ariaSnapshot())
  const input = page.getByRole('textbox', { name: 'Название новой подзадачи: Доделать проект', exact: true })
  const add = page.getByRole('button', { name: 'Добавить подзадачу: Доделать проект', exact: true })
  check(await page.locator('.app-sidebar').getByRole('button', { name: 'Статистика задач', exact: true }).count(), 0, 'Sidebar must not offer statistics, even in saved nav order')
  check(await page.locator('#priority-task-leaf .add-child-form').count(), 0, 'Leaf tasks must not offer premature splitting')
  check(await page.getByRole('textbox', { name: 'Название новой подзадачи: Пустой блок', exact: true }).isVisible(), true, 'Empty containers must remain editable')
  await input.fill('   ')
  check(await add.isDisabled(), true, 'Whitespace must not be submitted')
  await input.fill('  Новая подзадача  ')
  const firstRequest = page.waitForRequest(request => request.url().endsWith('/tasks/parent/focus/split'))
  await input.press('Enter')
  await firstRequest
  check(await input.isDisabled(), true, 'Input must be locked while saving')
  check(await add.isDisabled(), true, 'Duplicate submits must be blocked')
  check(requests.length, 1, 'Enter must create a single request')
  check(requests[0].children[0].title, 'Новая подзадача', 'Title must be trimmed')
  await pending.shift()(true)
  await page.getByRole('alert').waitFor()
  check(await input.inputValue(), '  Новая подзадача  ', 'Error must preserve the draft')
  const retryRequest = page.waitForRequest(request => request.url().endsWith('/tasks/parent/focus/split'))
  await add.click()
  await retryRequest
  check(requests[1].children[0].id, requests[0].children[0].id, 'Retry must keep its id')
  await pending.shift()(false)
  await page.getByText('Новая подзадача', { exact: true }).waitFor()
  check(tasks.filter(task => task.title === 'Новая подзадача').length, 1, 'Retry must not duplicate a committed task')
  check(await input.inputValue(), '', 'Successful save must clear the input')
  check(await input.evaluate(el => el === document.activeElement), true, 'Focus must return for the next task')
  check(await page.getByRole('alert').count(), 0, 'Successful retry must clear the error')
  await page.getByRole('button', { name: 'Свернуть подзадачи: Доделать проект', exact: true }).click()
  check(await input.isVisible(), false, 'Collapse must hide the add form')
  await page.getByRole('button', { name: 'Развернуть подзадачи: Доделать проект', exact: true }).click()
  await page.evaluate(() => { window.subtaskTestBoard.state.value.tasks.find(task => task.id === 'parent').completed = true })
  check(await page.locator('#priority-subtasks-parent .add-child-form').count(), 0, 'Completed ancestors must lock nested forms too')
  await page.evaluate(() => { window.subtaskTestBoard.state.value.tasks.find(task => task.id === 'parent').completed = false })
  await page.screenshot({ path: 'output/playwright/subtask-desktop.png', fullPage: true })
  await page.reload()
  await mount()
  check(await page.getByText('Новая подзадача', { exact: true }).count(), 1, 'Reloading saved API data must retain the child')
  await page.setViewportSize({ width: 390, height: 844 })
  const nestedInput = page.getByRole('textbox', { name: 'Название новой подзадачи: Вложенный блок', exact: true })
  await nestedInput.fill('Подзадача на телефоне')
  const nestedRequest = page.waitForRequest(request => request.url().endsWith('/tasks/nested/focus/split'))
  await page.getByRole('button', { name: 'Добавить подзадачу: Вложенный блок', exact: true }).click()
  await nestedRequest
  await pending.shift()(false)
  await page.getByText('Подзадача на телефоне', { exact: true }).waitFor()
  const bounds = await nestedInput.boundingBox()
  check(Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390), true, 'Mobile input must fit the viewport')
  await page.screenshot({ path: 'output/playwright/subtask-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Статистика', exact: true }).click()
  await page.getByRole('heading', { name: 'Статистика', exact: true }).waitFor()
  await page.evaluate(() => window.subtaskTestApp.unmount())
  console.log('PASS: Enter/button creation, whitespace, pending state, failed-response retry without duplicates, saved-data reload, nested/empty/locked containers, collapse, desktop/mobile, statistics navigation')
}
