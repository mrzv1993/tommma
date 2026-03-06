const STORAGE_KEY = "tommma.v1";
const STORAGE_BACKUP_KEY = "tommma.v1.backup";
const LOCAL_TEST_AUTH_KEY = "tommma.local_test_auth.v1";
const MAX_PLAN_MINUTES = 1440;
const REMOTE_STATE_URL = "api/state.php";
const AUTH_API_URL = "api/auth.php";
const REMOTE_SAVE_DEBOUNCE_MS = 700;
const REMOTE_SYNC_ENABLED =
  window.location.protocol === "http:" || window.location.protocol === "https:";
const NICKNAME_RE = /^[A-Za-z0-9]{3,32}$/;
const PARALLAX_MAX_X = 44;
const PARALLAX_MAX_Y = 28;
const DAY_PROGRESS_ICONS = {
  zero: "./assets/progress/progress-0.svg",
  complete: "./assets/progress/progress-100.svg",
};
const SUBTASK_RAIL_ICONS = {
  mid: "./assets/subtasks/rail-mid.svg",
  last: "./assets/subtasks/rail-last.svg",
};
const TODO_PROJECT_COLORS = [
  "#dce9ff",
  "#ffe2d3",
  "#fce2ef",
  "#efe4ff",
  "#d7f2e5",
  "#ffe8ab",
];
const DEFAULT_TODO_PROJECT = Object.freeze({
  id: "todo-default",
  name: "Проект 1",
  color: TODO_PROJECT_COLORS[0],
});

const state = loadState();
const authState = {
  bootstrapping: true,
  user: null,
  view: "login",
  pendingEmail: "",
  formError: "",
  busy: false,
};
const app = document.getElementById("app");
let undoTimeoutId = null;
let remoteSaveTimeoutId = null;
let lastRemoteSavePayload = null;
let destroyAuthParallax = null;

init();

function isPrivateIpv4(hostname) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  return (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
  );
}

function isLocalDevHost() {
  const host = (window.location.hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    host.endsWith(".test") ||
    isPrivateIpv4(host)
  );
}

function canUseLocalTestCredentials(login, password) {
  return isLocalDevHost() && login === "testuser" && password === "Test12345";
}

function getLocalTestUser() {
  if (localStorage.getItem(LOCAL_TEST_AUTH_KEY) !== "1") return null;
  return {
    id: "local-test",
    nickname: "testuser",
    email: "testuser@local.test",
    email_verified_at: "local",
  };
}

function enableLocalTestUser() {
  localStorage.setItem(LOCAL_TEST_AUTH_KEY, "1");
  authState.user = getLocalTestUser();
  authState.view = "app";
}

function disableLocalTestUser() {
  localStorage.removeItem(LOCAL_TEST_AUTH_KEY);
}

async function init() {
  attachGlobalHandlers();
  normalizeRunningSessions();
  await hydrateAuthSession();
  render();
  if (authState.user) {
    hydrateStateFromRemote();
  }
  setInterval(tick, 1000);
}

function defaultState() {
  return {
    tasks: [],
    todoProjects: [{ ...DEFAULT_TODO_PROJECT }],
    selectedTodoProjectId: DEFAULT_TODO_PROJECT.id,
    updatedAt: 0,
    selectedTaskId: null,
    dayOffset: 0,
    showTodo: true,
    mobileTodoOpen: false,
    editing: null,
    editingSubtask: null,
    creatingInColumn: null,
    creatingSubtaskInTaskId: null,
    taskMenuTaskId: null,
    todoProjectMenuOpen: false,
    collapsedChecklistTaskIds: [],
    recentlyDeleted: null,
    lastKnownDateKey: getTodayKey(),
  };
}

function loadState() {
  const parseState = (raw) => {
    if (!raw) return null;
    try {
      return normalizeLoadedState(JSON.parse(raw));
    } catch (_e) {
      return null;
    }
  };

  try {
    const primary = parseState(localStorage.getItem(STORAGE_KEY));
    if (primary) return primary;
    const backup = parseState(localStorage.getItem(STORAGE_BACKUP_KEY));
    if (backup) return backup;
    return defaultState();
  } catch (_e) {
    return defaultState();
  }
}

function saveState() {
  state.updatedAt = Date.now();
  const serialized = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
  } catch (_e) {
    // Keep runtime responsive even when storage quota is exhausted.
  }
  if (authState.user) {
    queueRemoteSave(serialized);
  }
}

function normalizeLoadedState(candidate) {
  if (!candidate || !Array.isArray(candidate.tasks)) return defaultState();

  const todoProjects = normalizeTodoProjects(candidate.todoProjects);
  const selectedTodoProjectId = resolveSelectedTodoProjectId(
    todoProjects,
    candidate.selectedTodoProjectId
  );
  const knownProjectIds = new Set(todoProjects.map((project) => project.id));

  const tasks = candidate.tasks.map((task) => {
    const normalizedTask = {
      ...task,
      sessionSeconds: Number(task.sessionSeconds || 0),
      sessionStartedAt: task.sessionStartedAt || null,
      actualMinutes: Number(task.actualMinutes || 0),
      plannedMinutes:
        typeof task.plannedMinutes === "number" ? task.plannedMinutes : null,
      todoProjectId:
        typeof task.todoProjectId === "string" && task.todoProjectId.trim()
          ? task.todoProjectId.trim()
          : null,
      deadlineDateKey: isDateKey(task.deadlineDateKey) ? task.deadlineDateKey : null,
      subtasks: Array.isArray(task.subtasks)
        ? task.subtasks
            .filter(
              (subtask) =>
                subtask &&
                typeof subtask.title === "string" &&
                subtask.title.trim() &&
                typeof subtask.id === "string" &&
                subtask.id.trim()
            )
            .map((subtask) => ({
              id: subtask.id,
              title: subtask.title.trim(),
              completed: !!subtask.completed,
              createdAt: Number(subtask.createdAt || Date.now()),
            }))
        : [],
    };

    if (
      normalizedTask.columnId === "todo" &&
      (!normalizedTask.todoProjectId ||
        !knownProjectIds.has(normalizedTask.todoProjectId))
    ) {
      normalizedTask.todoProjectId = selectedTodoProjectId;
    }

    syncTaskCompletionFromSubtasks(normalizedTask);
    return normalizedTask;
  });

  return {
    ...defaultState(),
    ...candidate,
    todoProjects,
    selectedTodoProjectId,
    updatedAt:
      Number.isFinite(Number(candidate.updatedAt)) && Number(candidate.updatedAt) > 0
        ? Number(candidate.updatedAt)
        : 0,
    tasks,
  };
}

async function flushRemoteSaveNow() {
  if (!authState.user) return;
  if (remoteSaveTimeoutId) {
    clearTimeout(remoteSaveTimeoutId);
    remoteSaveTimeoutId = null;
  }
  const serialized = JSON.stringify(state);
  await pushStateToRemote(serialized);
}

function queueRemoteSave(serializedState) {
  if (!REMOTE_SYNC_ENABLED) return;
  if (serializedState === lastRemoteSavePayload) return;

  if (remoteSaveTimeoutId) {
    clearTimeout(remoteSaveTimeoutId);
  }

  remoteSaveTimeoutId = setTimeout(() => {
    pushStateToRemote(serializedState);
  }, REMOTE_SAVE_DEBOUNCE_MS);
}

async function pushStateToRemote(serializedState) {
  try {
    const response = await fetch(REMOTE_STATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: serializedState,
    });
    if (!response.ok) return;
    lastRemoteSavePayload = serializedState;
  } catch (_e) {
    // Ignore network errors and keep local mode working.
  }
}

async function hydrateStateFromRemote() {
  if (!REMOTE_SYNC_ENABLED || !authState.user) return;

  try {
    const response = await fetch(REMOTE_STATE_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;

    const payload = await response.json();
    if (!payload?.ok || !payload.state) return;

    const remoteState = normalizeLoadedState(payload.state);
    const localUpdatedAt = Number(state.updatedAt || 0);
    const remoteUpdatedAt = Number(remoteState.updatedAt || 0);
    if (remoteUpdatedAt < localUpdatedAt) {
      queueRemoteSave(JSON.stringify(state));
      return;
    }
    Object.assign(state, remoteState);

    const serialized = JSON.stringify(state);
    lastRemoteSavePayload = serialized;
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      localStorage.setItem(STORAGE_BACKUP_KEY, serialized);
    } catch (_e) {
      // Ignore quota errors and keep app state in memory.
    }
    render();
  } catch (_e) {
    // Ignore network errors and keep local mode working.
  }
}

async function authRequest(action, payload = {}, method = "POST") {
  const options = {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  };

  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(`${AUTH_API_URL}?action=${action}`, options);
  let data = null;
  try {
    data = await response.json();
  } catch (_e) {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

async function hydrateAuthSession() {
  if (!REMOTE_SYNC_ENABLED) {
    authState.bootstrapping = false;
    authState.user = { id: "local" };
    return;
  }

  const localTestUser = getLocalTestUser();
  if (localTestUser) {
    authState.bootstrapping = false;
    authState.user = localTestUser;
    authState.view = "app";
    return;
  }

  try {
    const { ok, data } = await authRequest("session", {}, "GET");
    if (ok && data?.ok && data.user) {
      authState.user = data.user;
      authState.view = "app";
    } else {
      authState.user = null;
      authState.view = "login";
    }
  } catch (_e) {
    authState.user = null;
    authState.view = "login";
  } finally {
    authState.bootstrapping = false;
  }
}

function attachGlobalHandlers() {
  window.addEventListener("resize", render);

  document.addEventListener("click", (event) => {
    if (!authState.user) return;

    const target = event.target;
    if (
      target.closest(".task") ||
      target.closest(".subtasks") ||
      target.closest(".task-menu") ||
      target.closest(".todo-project-menu") ||
      target.closest(".player") ||
      target.closest(".inline-input") ||
      target.closest(".toolbar") ||
      target.closest(".todo-modal")
    ) {
      return;
    }

    state.selectedTaskId = null;
    state.editing = null;
    state.editingSubtask = null;
    state.creatingInColumn = null;
    state.creatingSubtaskInTaskId = null;
    state.taskMenuTaskId = null;
    state.todoProjectMenuOpen = false;
    render();
    saveState();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (state.mobileTodoOpen) {
        state.mobileTodoOpen = false;
        render();
        saveState();
      }
    }
  });
}

function tick() {
  if (!authState.user) return;
  maybeAutoStopOnDateChange();
  const selected = getSelectedTask();
  if (selected && (selected.sessionStartedAt || selected.sessionSeconds > 0)) {
    renderPlayerTime(selected);
  }
  renderTaskTimes();
}

function maybeAutoStopOnDateChange() {
  const today = getTodayKey();
  if (today === state.lastKnownDateKey) return;

  const running = state.tasks.find((task) => !!task.sessionStartedAt);
  if (running) stopTaskSession(running);

  state.lastKnownDateKey = today;
  saveState();
  render();
}

function normalizeRunningSessions() {
  maybeAutoStopOnDateChange();
}

function makeTask({
  title,
  columnId,
  todoProjectId = null,
  deadlineDateKey = null,
  plannedMinutes = null,
  actualMinutes = 0,
  completed = false,
  subtasks = [],
}) {
  return {
    id: crypto.randomUUID(),
    title,
    columnId,
    todoProjectId,
    deadlineDateKey,
    plannedMinutes,
    actualMinutes,
    completed,
    sessionSeconds: 0,
    sessionStartedAt: null,
    createdAt: Date.now(),
    subtasks,
  };
}

function makeSubtask(title) {
  return {
    id: crypto.randomUUID(),
    title,
    completed: false,
    createdAt: Date.now(),
  };
}

function hasSubtasks(task) {
  return Array.isArray(task.subtasks) && task.subtasks.length > 0;
}

function syncTaskCompletionFromSubtasks(task) {
  if (!hasSubtasks(task)) return;
  task.completed = task.subtasks.every((subtask) => !!subtask.completed);
}

function getTodayKey() {
  return toDateKey(new Date());
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekStart(date) {
  const day = date.getDay();
  return addDays(startOfDay(date), -day);
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDayMonthFromDateKey(dateKey) {
  if (!isDateKey(dateKey)) return "";
  const [, month, day] = dateKey.split("-");
  return `${day}.${month}`;
}

function resolveDeadlineDateKey(day, month) {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const now = new Date();
  const baseYear = now.getFullYear();

  const makeCandidate = (year) => {
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  };

  let candidate = makeCandidate(baseYear);
  if (!candidate) return null;

  const today = startOfDay(now);
  if (startOfDay(candidate) < today) {
    const nextYearCandidate = makeCandidate(baseYear + 1);
    if (!nextYearCandidate) return null;
    candidate = nextYearCandidate;
  }

  return toDateKey(candidate);
}

function isMobile() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function getVisibleDayCount() {
  if (isMobile()) return 1;
  return state.showTodo ? 5 : 6;
}

function getVisibleDates() {
  const first = getFirstVisibleDate();
  const count = getVisibleDayCount();
  const dates = [];
  for (let i = 0; i < count; i += 1) {
    dates.push(addDays(first, i));
  }
  return dates;
}

function getFirstVisibleDate() {
  const base = addDays(startOfDay(new Date()), state.dayOffset);
  return base;
}

function formatDayLabel(date) {
  const dayMonthFmt = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  });
  const weekdayFmt = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
  });
  return `${dayMonthFmt.format(date)}, ${weekdayFmt.format(date)}`;
}

function getDayCompletionPercent(columnId) {
  const tasks = columnTasks(columnId);
  if (!tasks.length) return 0;
  const units = tasks.reduce(
    (acc, task) => {
      if (hasSubtasks(task)) {
        acc.total += task.subtasks.length;
        acc.completed += task.subtasks.filter((subtask) => subtask.completed).length;
        return acc;
      }
      acc.total += 1;
      acc.completed += task.completed ? 1 : 0;
      return acc;
    },
    { completed: 0, total: 0 }
  );
  if (!units.total) return 0;
  return clamp(Math.round((units.completed / units.total) * 100), 0, 100);
}

function getDayProgressState(progressPercent) {
  if (progressPercent <= 0) return "zero";
  if (progressPercent >= 100) return "complete";
  return "partial";
}

function renderPartialProgressIcon(progressPercent) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const normalized = clamp(progressPercent, 1, 99);
  const dashOffset = circumference * (1 - normalized / 100);

  return `
    <svg class="day-progress-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="7" r="${radius}" fill="none" stroke="#B5BCCA" stroke-opacity="0.4" stroke-width="2"></circle>
      <circle
        cx="8"
        cy="7"
        r="${radius}"
        fill="none"
        stroke="#8AE978"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${dashOffset}"
        transform="rotate(-90 8 7)"
      ></circle>
    </svg>
  `;
}

function renderDayProgress(columnId) {
  const progressPercent = getDayCompletionPercent(columnId);
  const progressState = getDayProgressState(progressPercent);
  let progressIconMarkup = "";
  if (progressState === "partial") {
    progressIconMarkup = renderPartialProgressIcon(progressPercent);
  } else {
    progressIconMarkup = `<img class="day-progress-icon" src="${DAY_PROGRESS_ICONS[progressState]}" alt="" aria-hidden="true" />`;
  }

  return `
    <span class="day-progress" aria-label="Выполнено ${progressPercent}% задач">
      <span class="day-progress-label">${progressPercent}%</span>
      ${progressIconMarkup}
    </span>
  `;
}

function formatTimerHMS(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(safe / 3600)).padStart(2, "0");
  const m = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const s = String(safe % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatTimerHtml(seconds) {
  const formatted = formatTimerHMS(seconds);
  const [hh, mm, ss] = formatted.split(":");
  return `<span class="player-time-main">${hh}:${mm}</span><span class="player-time-seconds">:${ss}</span>`;
}

function formatClockMinutes(minutes) {
  const safe = Math.max(0, Math.floor(minutes));
  return String(safe).padStart(2, "0");
}

function getTaskById(taskId) {
  return state.tasks.find((task) => task.id === taskId) || null;
}

function getSelectedTask() {
  return getTaskById(state.selectedTaskId);
}

function getTaskElapsedSessionSeconds(task) {
  const running = task.sessionStartedAt
    ? (Date.now() - task.sessionStartedAt) / 1000
    : 0;
  return task.sessionSeconds + running;
}

function hasStartedProgress(task) {
  return !!task.sessionStartedAt || task.sessionSeconds > 0;
}

function getTaskProgressMinutes(task) {
  return task.actualMinutes + getTaskElapsedSessionSeconds(task) / 60;
}

function isTaskFromToday(task) {
  if (!task.columnId.startsWith("day:")) return false;
  const dateKey = task.columnId.replace("day:", "");
  return dateKey === getTodayKey();
}

function hasTimer(task) {
  return typeof task.plannedMinutes === "number" && task.plannedMinutes > 0;
}

function pauseRunningTask(task) {
  if (!task.sessionStartedAt) return;
  task.sessionSeconds = getTaskElapsedSessionSeconds(task);
  task.sessionStartedAt = null;
}

function stopTaskSession(task) {
  if (task.sessionStartedAt) {
    task.sessionSeconds = getTaskElapsedSessionSeconds(task);
    task.sessionStartedAt = null;
  }

  if (task.sessionSeconds > 0) {
    task.actualMinutes += task.sessionSeconds / 60;
    task.sessionSeconds = 0;
  }
}

function startTask(task) {
  if (!hasTimer(task)) return;
  if (!isTaskFromToday(task)) return;

  state.tasks.forEach((item) => {
    if (item.id !== task.id && item.sessionStartedAt) pauseRunningTask(item);
  });

  if (!task.sessionStartedAt) {
    task.sessionStartedAt = Date.now();
  }

  saveState();
  render();
}

function pauseTask(task) {
  pauseRunningTask(task);
  saveState();
  render();
}

function stopTask(task) {
  stopTaskSession(task);
  saveState();
  render();
}

function parseTaskInput(raw) {
  const value = raw.trim();
  if (!value) return null;

  const parseTitleAndDeadline = (titleRaw) => {
    const dateTokenMatch = titleRaw.match(/^(.*?)(?:\s+(\d{2}\.\d{2}))$/);
    if (!dateTokenMatch) {
      return { title: titleRaw, deadlineDateKey: null };
    }

    const maybeTitle = dateTokenMatch[1].trim();
    const [dayStr, monthStr] = dateTokenMatch[2].split(".");
    const deadlineDateKey = resolveDeadlineDateKey(Number(dayStr), Number(monthStr));

    if (!deadlineDateKey || !maybeTitle) {
      return { title: titleRaw, deadlineDateKey: null };
    }

    return { title: maybeTitle, deadlineDateKey };
  };

  const slashIndex = value.lastIndexOf("/");
  if (slashIndex === -1) {
    const { title, deadlineDateKey } = parseTitleAndDeadline(value);
    return { title, plannedMinutes: null, deadlineDateKey };
  }

  const titlePart = value.slice(0, slashIndex).trim();
  const suffix = value.slice(slashIndex + 1).trim();

  if (!titlePart) return null;

  const { title, deadlineDateKey } = parseTitleAndDeadline(titlePart);
  if (!title) return null;

  if (/^\d+$/.test(suffix)) {
    const minutes = Number(suffix);
    if (minutes > 0 && minutes <= MAX_PLAN_MINUTES) {
      return { title, plannedMinutes: minutes, deadlineDateKey };
    }

    return { title, plannedMinutes: null, deadlineDateKey };
  }

  return { title, plannedMinutes: null, deadlineDateKey };
}

function normalizeTodoProjects(projects) {
  if (!Array.isArray(projects)) {
    return [{ ...DEFAULT_TODO_PROJECT }];
  }

  const normalized = projects
    .map((project, index) => {
      if (!project || typeof project !== "object") return null;
      const id =
        typeof project.id === "string" && project.id.trim()
          ? project.id.trim()
          : `todo-project-${index + 1}`;
      const name =
        typeof project.name === "string" && project.name.trim()
          ? project.name.trim().slice(0, 28)
          : `Проект ${index + 1}`;
      return {
        id,
        name,
        color: sanitizeProjectColor(project.color, index),
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return [{ ...DEFAULT_TODO_PROJECT }];
  }

  return normalized;
}

function resolveSelectedTodoProjectId(projects, selectedId) {
  if (typeof selectedId === "string" && projects.some((item) => item.id === selectedId)) {
    return selectedId;
  }
  return projects[0].id;
}

function getActiveTodoProjectId() {
  const resolved = resolveSelectedTodoProjectId(
    state.todoProjects,
    state.selectedTodoProjectId
  );
  if (resolved !== state.selectedTodoProjectId) {
    state.selectedTodoProjectId = resolved;
  }
  return resolved;
}

function sanitizeProjectColor(color, index = 0) {
  if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color.trim())) {
    return color.trim();
  }
  return TODO_PROJECT_COLORS[index % TODO_PROJECT_COLORS.length];
}

function createTodoProject(rawName) {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 28);
  if (!name) return null;
  return {
    id: crypto.randomUUID(),
    name,
    color: TODO_PROJECT_COLORS[state.todoProjects.length % TODO_PROJECT_COLORS.length],
  };
}

function getActiveTodoProject() {
  const activeId = getActiveTodoProjectId();
  return state.todoProjects.find((project) => project.id === activeId) || null;
}

function moveTodoProjectByDrag(
  draggedProjectId,
  targetProjectId = null,
  position = "after"
) {
  if (!draggedProjectId) return false;
  const draggedIndex = state.todoProjects.findIndex(
    (project) => project.id === draggedProjectId
  );
  if (draggedIndex === -1) return false;

  const nextProjects = [...state.todoProjects];
  const [draggedProject] = nextProjects.splice(draggedIndex, 1);

  let insertIndex = nextProjects.length;
  if (targetProjectId) {
    const targetIndex = nextProjects.findIndex(
      (project) => project.id === targetProjectId
    );
    if (targetIndex === -1) return false;
    insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  }

  nextProjects.splice(insertIndex, 0, draggedProject);
  state.todoProjects = nextProjects;

  return true;
}

function projectLabelLetters(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "P";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("")
    .slice(0, 2);
}

function columnTasks(columnId) {
  if (columnId === "todo") {
    const activeProjectId = getActiveTodoProjectId();
    return state.tasks.filter(
      (task) => task.columnId === "todo" && task.todoProjectId === activeProjectId
    );
  }
  return state.tasks.filter((task) => task.columnId === columnId);
}

function createTaskInColumn(columnId, raw) {
  const parsed = parseTaskInput(raw);
  if (!parsed) {
    state.creatingInColumn = null;
    render();
    saveState();
    return;
  }

  const task = makeTask({
    title: parsed.title,
    plannedMinutes: parsed.plannedMinutes,
    columnId,
    todoProjectId: columnId === "todo" ? getActiveTodoProjectId() : null,
    deadlineDateKey: columnId === "todo" ? parsed.deadlineDateKey : null,
  });

  state.tasks.push(task);
  state.creatingInColumn = columnId;
  state.selectedTaskId = task.id;
  state.editing = null;
  state.editingSubtask = null;
  state.creatingSubtaskInTaskId = null;
  state.taskMenuTaskId = null;
  saveState();
  render();
  focusCreateTaskInput(columnId);
}

function moveTaskByDrag(
  draggedTaskId,
  targetTaskId = null,
  position = "after",
  targetColumnId = null
) {
  if (!draggedTaskId) return false;

  const draggedIndex = state.tasks.findIndex((task) => task.id === draggedTaskId);
  if (draggedIndex === -1) return false;

  const draggedTask = state.tasks[draggedIndex];
  const sourceColumnId = draggedTask.columnId;

  let resolvedColumnId = targetColumnId || sourceColumnId;

  if (targetTaskId) {
    const targetTask = getTaskById(targetTaskId);
    if (!targetTask) return false;
    resolvedColumnId = targetTask.columnId;
  }

  const nextTasks = [...state.tasks];
  const [taskToMove] = nextTasks.splice(draggedIndex, 1);
  taskToMove.columnId = resolvedColumnId;
  if (resolvedColumnId === "todo") {
    taskToMove.todoProjectId = getActiveTodoProjectId();
  } else {
    taskToMove.todoProjectId = null;
    taskToMove.deadlineDateKey = null;
  }

  let insertIndex = nextTasks.length;

  if (targetTaskId) {
    const targetIndex = nextTasks.findIndex((task) => task.id === targetTaskId);
    if (targetIndex === -1) return false;
    insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  } else {
    const lastIndexInColumn = nextTasks.reduce(
      (found, task, index) => (task.columnId === resolvedColumnId ? index : found),
      -1
    );
    insertIndex = lastIndexInColumn === -1 ? nextTasks.length : lastIndexInColumn + 1;
  }

  nextTasks.splice(insertIndex, 0, taskToMove);
  state.tasks = nextTasks;

  return !(sourceColumnId === resolvedColumnId && draggedIndex === insertIndex);
}

function updateTaskFromInput(task, raw) {
  const parsed = parseTaskInput(raw);
  if (!parsed) {
    state.editing = null;
    render();
    saveState();
    return;
  }

  task.title = parsed.title;
  task.plannedMinutes = parsed.plannedMinutes;
  task.deadlineDateKey = task.columnId === "todo" ? parsed.deadlineDateKey : null;
  if (!hasTimer(task)) {
    task.sessionSeconds = 0;
    task.sessionStartedAt = null;
    if (state.selectedTaskId === task.id) {
      // selection remains, but player will disappear automatically
    }
  }

  state.editing = null;
  saveState();
  render();
}

function removeTask(taskId) {
  const task = getTaskById(taskId);
  if (!task) return;
  if (task.sessionStartedAt) return;

  const idx = state.tasks.findIndex((item) => item.id === taskId);
  if (idx === -1) return;

  state.tasks.splice(idx, 1);
  state.recentlyDeleted = { task, index: idx, expiresAt: Date.now() + 5000 };
  if (state.selectedTaskId === taskId) {
    state.selectedTaskId = null;
  }
  if (state.creatingSubtaskInTaskId === taskId) {
    state.creatingSubtaskInTaskId = null;
  }
  if (state.taskMenuTaskId === taskId) {
    state.taskMenuTaskId = null;
  }
  if (state.editingSubtask?.taskId === taskId) {
    state.editingSubtask = null;
  }
  state.collapsedChecklistTaskIds = state.collapsedChecklistTaskIds.filter(
    (id) => id !== taskId
  );

  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
  }

  undoTimeoutId = setTimeout(() => {
    state.recentlyDeleted = null;
    saveState();
    render();
  }, 5000);

  saveState();
  render();
}

function undoDelete() {
  if (!state.recentlyDeleted) return;
  const { task, index } = state.recentlyDeleted;
  state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
  state.recentlyDeleted = null;

  if (undoTimeoutId) {
    clearTimeout(undoTimeoutId);
    undoTimeoutId = null;
  }

  saveState();
  render();
}

function render() {
  if (authState.bootstrapping) {
    teardownAuthParallax();
    app.innerHTML = `<div class="auth-shell"><div class="auth-card"><h1 class="auth-title">Загрузка…</h1></div></div>`;
    return;
  }

  if (!authState.user) {
    renderAuth();
    return;
  }

  teardownAuthParallax();
  const visibleDates = getVisibleDates();
  const today = getTodayKey();
  const mobile = isMobile();

  app.innerHTML = `
    <div class="layout ${mobile ? "mobile" : "desktop"} ${
      state.showTodo ? "todo-open" : "todo-closed"
    }">
      ${mobile ? "" : renderTodoColumn()}
      <main class="days" id="days-container">
        ${visibleDates
          .map((date) => renderDayColumn(date, toDateKey(date) === today))
          .join("")}
      </main>

      ${renderBottomControls()}
      ${renderPlayer()}
      ${mobile ? renderMobileTodoButton() : ""}
      ${renderUndoToast()}
      ${mobile ? renderMobileTodoModal() : ""}
    </div>
  `;

  wireRenderedHandlers();
}

function renderAuth() {
  if (authState.view === "verify") {
    app.innerHTML = renderVerifyView();
  } else if (authState.view === "register") {
    app.innerHTML = renderRegisterView();
  } else if (authState.view === "forgot") {
    app.innerHTML = renderForgotView();
  } else {
    app.innerHTML = renderLoginView();
  }
  wireAuthHandlers();
  setupAuthParallax();
}

function renderAuthError() {
  return authState.formError
    ? `<div class="auth-error">${escapeHtml(authState.formError)}</div>`
    : "";
}

function renderRegisterView() {
  return `
    <section class="auth-shell">
      <div class="auth-stage">
        ${renderAuthParallaxScene()}
        <div class="auth-content">
          <form class="auth-card" id="register-form">
            <h1 class="auth-title">Регистрация</h1>
            <p class="auth-subtitle">Создайте аккаунт для работы с задачами</p>
            ${renderAuthError()}
            <label class="auth-label">Никнейм</label>
            <input class="auth-input" name="nickname" autocomplete="username" required placeholder="Только латиница и цифры" />
            <label class="auth-label">Email</label>
            <input class="auth-input" name="email" type="email" autocomplete="email" required />
            <label class="auth-label">Пароль</label>
            <input class="auth-input" name="password" type="password" autocomplete="new-password" required />
            <button class="auth-btn" type="submit" ${authState.busy ? "disabled" : ""}>Зарегистрироваться</button>
            <button class="auth-link" data-auth-action="go-login" type="button">Уже есть аккаунт?</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderLoginView() {
  return `
    <section class="auth-shell">
      <div class="auth-stage">
        ${renderAuthParallaxScene()}
        <div class="auth-content">
          <form class="auth-card" id="login-form">
            <h1 class="auth-title">Вход</h1>
            <p class="auth-subtitle">Введите данные аккаунта</p>
            ${renderAuthError()}
            <label class="auth-label">Никнейм или email</label>
            <input class="auth-input" name="login" autocomplete="username" required />
            <label class="auth-label">Пароль</label>
            <input class="auth-input" name="password" type="password" autocomplete="current-password" required />
            <button class="auth-btn" type="submit" ${authState.busy ? "disabled" : ""}>Войти</button>
            <button class="auth-link" data-auth-action="go-forgot" type="button">Восстановить пароль</button>
            <button class="auth-link" data-auth-action="go-register" type="button">Нет аккаунта?</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderVerifyView() {
  return `
    <section class="auth-shell verify-shell">
      <div class="auth-stage">
        ${renderAuthParallaxScene()}
        <div class="auth-content">
          <form class="auth-card verify-card" id="verify-form">
            <h1 class="auth-title verify-title">Please check your email</h1>
            <p class="auth-subtitle verify-subtitle">
              We've sent a confirmation code to
              <span class="verify-email">${escapeHtml(authState.pendingEmail || "вашу почту")}</span>.
              Please enter it below to confirm your email address.
            </p>
            ${renderAuthError()}
            <label class="auth-label">Код подтверждения</label>
            <input
              class="auth-input verify-input"
              name="code"
              inputmode="numeric"
              maxlength="6"
              pattern="\\d{6}"
              placeholder="000000"
              required
            />
            <button class="auth-btn" type="submit" ${authState.busy ? "disabled" : ""}>Подтвердить</button>
            <button class="auth-link" data-auth-action="resend" type="button">Отправить код еще раз</button>
            <button class="auth-link" data-auth-action="go-login" type="button">Назад ко входу</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderForgotView() {
  return `
    <section class="auth-shell">
      <div class="auth-stage">
        ${renderAuthParallaxScene()}
        <div class="auth-content">
          <div class="auth-card">
            <h1 class="auth-title">Восстановление пароля</h1>
            <p class="auth-subtitle">Функция будет добавлена следующим шагом.</p>
            <button class="auth-link auth-link-block" data-auth-action="go-login" type="button">Вернуться ко входу</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAuthParallaxScene() {
  return `
    <div class="auth-scene" data-parallax-scene>
      <div class="auth-scene-layer sky" data-parallax-layer data-depth="0.35"></div>
      <div class="auth-scene-layer clouds" data-parallax-layer data-depth="0.65"></div>
      <div class="auth-scene-layer field" data-parallax-layer data-depth="1"></div>
    </div>
  `;
}

function setupAuthParallax() {
  teardownAuthParallax();

  const scene = app.querySelector("[data-parallax-scene]");
  const stage = app.querySelector(".auth-stage");
  if (!scene || !stage) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const layers = Array.from(scene.querySelectorAll("[data-parallax-layer]"));
  if (!layers.length) return;

  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let rafId = null;

  const apply = () => {
    currentX += (targetX - currentX) * 0.14;
    currentY += (targetY - currentY) * 0.14;

    layers.forEach((layer) => {
      const depth = Number(layer.dataset.depth || 1);
      const x = (currentX * depth).toFixed(2);
      const y = (currentY * depth).toFixed(2);
      const scale = (1.03 + depth * 0.015).toFixed(3);
      layer.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    });

    if (
      Math.abs(targetX - currentX) > 0.1 ||
      Math.abs(targetY - currentY) > 0.1
    ) {
      rafId = requestAnimationFrame(apply);
    } else {
      rafId = null;
    }
  };

  const queueApply = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(apply);
  };

  const updateTarget = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratioX = ((clientX - rect.left) / rect.width - 0.5) * 2;
    const ratioY = ((clientY - rect.top) / rect.height - 0.5) * 2;
    targetX = clamp(ratioX, -1, 1) * PARALLAX_MAX_X;
    targetY = clamp(ratioY, -1, 1) * PARALLAX_MAX_Y;
    queueApply();
  };

  const onMouseMove = (event) => {
    updateTarget(event.clientX, event.clientY);
  };

  const onMouseLeave = () => {
    targetX = 0;
    targetY = 0;
    queueApply();
  };

  stage.addEventListener("mousemove", onMouseMove);
  stage.addEventListener("mouseleave", onMouseLeave);

  destroyAuthParallax = () => {
    stage.removeEventListener("mousemove", onMouseMove);
    stage.removeEventListener("mouseleave", onMouseLeave);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    layers.forEach((layer) => {
      layer.style.transform = "";
    });
  };
}

function teardownAuthParallax() {
  if (!destroyAuthParallax) return;
  destroyAuthParallax();
  destroyAuthParallax = null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function shiftByDayWithAnimation(dayDelta) {
  const direction = Math.sign(dayDelta);
  if (!direction) return;
  state.dayOffset += direction;
  saveState();
  render();
}

function resetVisibleDaysToToday() {
  state.dayOffset = 0;
  saveState();
  render();
}

function renderTodoColumn() {
  if (!state.showTodo) return "";
  return `
    <aside class="column todo-column" data-column-id="todo">
      ${renderTodoProjectsStrip()}
      ${renderTodoProjectHeader()}
      <div class="task-list" data-column-id="todo">
        ${columnTasks("todo").map((task) => renderTask(task)).join("")}
        ${renderCreateArea("todo")}
      </div>
    </aside>
  `;
}

function renderTodoProjectsStrip(showClose = false) {
  const activeProjectId = getActiveTodoProjectId();
  return `
    <div class="todo-projects-strip">
      <div class="todo-projects-scroll" role="tablist" aria-label="Проекты Todo">
        ${state.todoProjects
          .map(
            (project) => `
            <button class="todo-project ${
              project.id === activeProjectId ? "active" : ""
            }" data-action="select-todo-project" data-project-id="${
              project.id
            }" type="button" role="tab" draggable="true" aria-selected="${
              project.id === activeProjectId
            }">
              <span class="todo-project-avatar" style="--todo-project-color: ${sanitizeProjectColor(
                project.color
              )};">${escapeHtml(projectLabelLetters(project.name))}</span>
              <span class="todo-project-name">${escapeHtml(project.name)}</span>
            </button>
          `
          )
          .join("")}
        <button class="todo-project todo-project-add" data-action="add-todo-project" type="button" aria-label="Добавить проект">
          <span class="todo-project-avatar">+</span>
          <span class="todo-project-name">Новый</span>
        </button>
      </div>
      ${
        showClose
          ? '<button class="icon-btn todo-projects-close" data-action="toggle-todo-modal" aria-label="Закрыть">×</button>'
          : ""
      }
    </div>
  `;
}

function renderTodoProjectHeader() {
  const project = getActiveTodoProject();
  if (!project) return "";
  const canDelete = state.todoProjects.length > 1;
  return `
    <div class="todo-project-header">
      <h2 class="column-title todo-project-title">${escapeHtml(project.name)}</h2>
      <div class="todo-project-menu-wrap ${state.todoProjectMenuOpen ? "open" : ""}">
        <button class="icon-btn menu-btn" data-action="toggle-todo-project-menu" aria-label="Меню проекта">⋮</button>
        ${
          state.todoProjectMenuOpen
            ? `<div class="task-menu todo-project-menu">
                <button class="task-menu-item" data-action="rename-todo-project" type="button">Переименовать</button>
                <button class="task-menu-item danger" data-action="delete-todo-project" type="button" ${
                  canDelete ? "" : "disabled"
                }>Удалить проект</button>
              </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderDayColumn(date, isToday) {
  const dateKey = toDateKey(date);
  const columnId = `day:${dateKey}`;
  const showProgress = dateKey <= getTodayKey();
  return `
    <section class="column day-column ${isToday ? "today" : ""}" data-column-id="${columnId}">
      <h2 class="column-title day-column-title">
        <span class="day-label">${formatDayLabel(date)}</span>
        ${showProgress ? renderDayProgress(columnId) : ""}
      </h2>
      <div class="task-list" data-column-id="${columnId}">
        ${columnTasks(columnId).map((task) => renderTask(task)).join("")}
        ${renderCreateArea(columnId)}
      </div>
    </section>
  `;
}

function renderTask(task) {
  const selected = task.id === state.selectedTaskId;
  const editing = state.editing?.taskId === task.id;
  const running = !!task.sessionStartedAt;
  const hasChecklist = Array.isArray(task.subtasks) && task.subtasks.length > 0;
  const checklistExpanded = isChecklistExpanded(task.id);
  const progressMinutes = hasTimer(task) ? getTaskProgressMinutes(task) : 0;
  const showFact =
    hasTimer(task) &&
    (task.actualMinutes > 0 || (hasStartedProgress(task) && progressMinutes > 1));
  const showPlanOnly = hasTimer(task) && !showFact;
  const showDeadline = task.columnId === "todo" && !!task.deadlineDateKey;
  const editValue = `${task.title}${showDeadline ? ` ${formatDayMonthFromDateKey(task.deadlineDateKey)}` : ""}${
    hasTimer(task) ? ` / ${Math.floor(task.plannedMinutes)}` : ""
  }`;

  return `
    <article class="task ${selected ? "active" : ""} ${
      task.completed ? "completed" : ""
    } ${running ? "running" : ""} ${
      hasChecklist ? "has-subtasks" : ""
    }" data-task-id="${task.id}" draggable="true">
      <button class="checkbox ${task.completed ? "checked" : ""}" data-action="toggle-check" aria-label="Отметить"></button>
      <div class="task-content">
        ${
          editing
            ? `<input class="inline-input edit-input" data-action="edit-input" value="${escapeHtml(
                editValue
              )}" />`
            : `<div class="task-title">${escapeHtml(task.title)}</div>`
        }
        ${
          showFact && !editing
            ? `<div class="badge">${formatClockMinutes(progressMinutes)} / ${formatClockMinutes(
                task.plannedMinutes
              )}</div>`
            : ""
        }
        ${
          !showFact && showPlanOnly && !editing
            ? `<div class="badge">${formatClockMinutes(task.plannedMinutes)}</div>`
            : ""
        }
        ${
          showDeadline && !editing
            ? `<div class="badge deadline-badge">${escapeHtml(
                formatDayMonthFromDateKey(task.deadlineDateKey)
              )}</div>`
            : ""
        }
        ${
          hasChecklist
            ? `<button class="icon-btn subtasks-btn" data-action="toggle-checklist" data-task-id="${task.id}" aria-label="Показать или скрыть чеклист">${checklistExpanded ? "☰" : "≡"}</button>`
            : ""
        }
      </div>
      <div class="task-menu-wrap ${
        state.taskMenuTaskId === task.id ? "open" : ""
      }">
        <button class="icon-btn menu-btn" data-action="toggle-task-menu" data-task-id="${
          task.id
        }" aria-label="Меню задачи">⋮</button>
        ${
          state.taskMenuTaskId === task.id
            ? `<div class="task-menu">
                <button class="task-menu-item" data-action="menu-add-checklist" data-task-id="${task.id}">Добавить чеклист</button>
                <button class="task-menu-item danger" data-action="menu-delete-task" data-task-id="${task.id}">Удалить задачу</button>
              </div>`
            : ""
        }
      </div>
    </article>
    ${renderSubtasks(task)}
  `;
}

function renderSubtasks(task) {
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const creating = state.creatingSubtaskInTaskId === task.id;
  const expanded = isChecklistExpanded(task.id);
  if (!subtasks.length && !creating) return "";
  if (!expanded && !creating) return "";

  return `
    <div class="subtasks" data-parent-task-id="${task.id}">
      <button class="icon-btn subtask-add-btn ${creating ? "visible" : ""}" data-action="add-subtask" data-task-id="${task.id}" aria-label="Добавить подзадачу">+</button>
      ${subtasks
        .map(
          (subtask, index) => {
            const editingSubtask =
              state.editingSubtask?.taskId === task.id &&
              state.editingSubtask?.subtaskId === subtask.id;
            const isLast = index === subtasks.length - 1;
            return `
            <div class="subtask-wrapper ${isLast ? "last" : ""}">
              <div class="subtask-rail" aria-hidden="true"><img class="subtask-rail-icon" src="${
                isLast ? SUBTASK_RAIL_ICONS.last : SUBTASK_RAIL_ICONS.mid
              }" alt="" /></div>
              <div class="subtask-item ${subtask.completed ? "completed" : ""}" data-subtask-id="${subtask.id}">
                <button class="checkbox ${
                  subtask.completed ? "checked" : ""
                }" data-action="toggle-subtask-check" data-task-id="${task.id}" data-subtask-id="${
              subtask.id
            }" aria-label="Отметить подзадачу"></button>
                ${
                  editingSubtask
                    ? `<input class="inline-input subtask-edit-input" data-task-id="${task.id}" data-subtask-id="${subtask.id}" value="${escapeHtml(
                        subtask.title
                      )}" />`
                    : `<div class="subtask-title">${escapeHtml(subtask.title)}</div>`
                }
                <button class="icon-btn subtask-delete-btn" data-action="delete-subtask" data-task-id="${
                  task.id
                }" data-subtask-id="${subtask.id}" aria-label="Удалить подзадачу">×</button>
              </div>
            </div>
          `;
          }
        )
        .join("")}
      ${
        creating
          ? `<div class="subtask-wrapper last subtask-create-wrapper"><div class="subtask-rail" aria-hidden="true"><img class="subtask-rail-icon" src="${SUBTASK_RAIL_ICONS.last}" alt="" /></div><div class="subtask-item subtask-create-row"><button class="checkbox" disabled aria-hidden="true"></button><input class="inline-input subtask-input" data-task-id="${task.id}" placeholder="Подзадача" autofocus /></div></div>`
          : ""
      }
    </div>
  `;
}

function isChecklistExpanded(taskId) {
  return !state.collapsedChecklistTaskIds.includes(taskId);
}

function toggleChecklist(taskId) {
  if (state.collapsedChecklistTaskIds.includes(taskId)) {
    state.collapsedChecklistTaskIds = state.collapsedChecklistTaskIds.filter(
      (id) => id !== taskId
    );
  } else {
    state.collapsedChecklistTaskIds = [...state.collapsedChecklistTaskIds, taskId];
  }
}

function focusCreateTaskInput(columnId) {
  requestAnimationFrame(() => {
    const nextInput = document.querySelector(
      `.create-input[data-column-id='${columnId}']`
    );
    if (!nextInput) return;
    nextInput.focus();
    nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
  });
}

function focusSubtaskInput(taskId) {
  requestAnimationFrame(() => {
    const nextInput = document.querySelector(
      `.subtask-input[data-task-id='${taskId}']`
    );
    if (!nextInput) return;
    nextInput.focus();
    nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
  });
}

function renderCreateArea(columnId) {
  const creating = state.creatingInColumn === columnId;
  if (creating) {
    return `<div class="task add-task-row editing"><span class="plus">+</span><input class="inline-input create-input" data-column-id="${columnId}" placeholder="Название / 240" autofocus /></div>`;
  }

  return `<button class="task add-task-row" data-action="create" data-column-id="${columnId}"><span class="plus">+</span><span>Добавить задачу</span></button>`;
}

function renderBottomControls() {
  return `
    <div class="toolbar">
      <button class="nav-btn" data-action="toggle-todo" title="Todo">${isMobile() ? "≡" : "‹"}</button>
      <div class="spacer"></div>
      <div class="nav-group">
        <button class="nav-btn" data-action="shift-week" data-value="-1">«</button>
        <button class="nav-btn" data-action="shift-day" data-value="-1">‹</button>
        <button class="nav-btn" data-action="reset-day">•</button>
        <button class="nav-btn" data-action="shift-day" data-value="1">›</button>
        <button class="nav-btn" data-action="shift-week" data-value="1">»</button>
      </div>
      <button class="nav-btn auth-logout-btn" data-action="logout" title="Выйти">Выйти</button>
    </div>
  `;
}

function renderPlayer() {
  const task = getSelectedTask();
  if (!task || !hasTimer(task)) return "";

  const running = !!task.sessionStartedAt;
  const canStart = isTaskFromToday(task);
  const elapsed = getTaskElapsedSessionSeconds(task);

  return `
    <section class="player">
      <button class="play-btn" data-action="${running ? "pause" : "play"}" data-task-id="${task.id}">
        ${running ? "❚❚" : "▶"}
      </button>
      <div class="player-title">${escapeHtml(task.title)}</div>
      <div class="player-time" data-player-time="${task.id}">${formatTimerHtml(elapsed)}</div>
      <span class="sr-only">${canStart ? "" : "Недоступно"}</span>
    </section>
  `;
}

function renderMobileTodoButton() {
  return `
    <button class="mobile-todo-toggle" data-action="toggle-todo-modal">Todo</button>
  `;
}

function renderMobileTodoModal() {
  return `
    <div class="todo-modal ${state.mobileTodoOpen ? "open" : ""}">
      <div class="todo-modal-card">
        ${renderTodoProjectsStrip(true)}
        ${renderTodoProjectHeader()}
        <div class="task-list" data-column-id="todo">
          ${columnTasks("todo").map((task) => renderTask(task)).join("")}
          ${renderCreateArea("todo")}
        </div>
      </div>
    </div>
  `;
}

function renderUndoToast() {
  if (!state.recentlyDeleted) return "";
  if (Date.now() > state.recentlyDeleted.expiresAt) return "";

  return `
    <div class="undo-toast">
      Задача удалена
      <button data-action="undo-delete">Отменить</button>
    </div>
  `;
}

function clearAuthError() {
  authState.formError = "";
}

function setAuthError(errorMessage) {
  authState.formError = errorMessage || "Произошла ошибка";
}

function wireAuthHandlers() {
  document.querySelectorAll("[data-auth-action='go-login']").forEach((button) => {
    button.addEventListener("click", () => {
      clearAuthError();
      authState.view = "login";
      authState.pendingEmail = "";
      render();
    });
  });

  document
    .querySelectorAll("[data-auth-action='go-register']")
    .forEach((button) => {
      button.addEventListener("click", () => {
        clearAuthError();
        authState.view = "register";
        render();
      });
    });

  document.querySelectorAll("[data-auth-action='go-forgot']").forEach((button) => {
    button.addEventListener("click", () => {
      clearAuthError();
      authState.view = "forgot";
      render();
    });
  });

  document.querySelectorAll("[data-auth-action='resend']").forEach((button) => {
    button.addEventListener("click", async () => {
      clearAuthError();
      authState.busy = true;
      render();

      try {
        const { ok, data } = await authRequest("resend");
        if (!ok || !data?.ok) {
          setAuthError(data?.error || "Не удалось отправить код");
        } else {
          setAuthError("Код отправлен повторно");
        }
      } catch (_e) {
        if (canUseLocalTestCredentials(login, password)) {
          enableLocalTestUser();
        } else {
          setAuthError("Ошибка сети");
        }
      } finally {
        authState.busy = false;
        render();
      }
    });
  });

  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(registerForm);
      const nickname = String(fd.get("nickname") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");

      if (!NICKNAME_RE.test(nickname)) {
        setAuthError("Никнейм: только латиница и цифры, 3-32 символа");
        render();
        return;
      }

      clearAuthError();
      authState.busy = true;
      render();

      try {
        const { ok, data } = await authRequest("register", {
          nickname,
          email,
          password,
        });
        if (!ok || !data?.ok) {
          setAuthError(data?.error || "Не удалось зарегистрироваться");
        } else {
          authState.pendingEmail = data.email || email;
          authState.view = "verify";
        }
      } catch (_e) {
        setAuthError("Ошибка сети");
      } finally {
        authState.busy = false;
        render();
      }
    });
  }

  const verifyForm = document.getElementById("verify-form");
  if (verifyForm) {
    verifyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(verifyForm);
      const code = String(fd.get("code") || "").trim();

      clearAuthError();
      authState.busy = true;
      render();

      try {
        const { ok, data } = await authRequest("verify", { code });
        if (!ok || !data?.ok) {
          setAuthError(data?.error || "Не удалось подтвердить email");
        } else {
          await hydrateAuthSession();
          if (authState.user) {
            await hydrateStateFromRemote();
            render();
          } else {
            authState.view = "login";
            render();
          }
          return;
        }
      } catch (_e) {
        setAuthError("Ошибка сети");
      } finally {
        authState.busy = false;
        render();
      }
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(loginForm);
      const login = String(fd.get("login") || "").trim();
      const password = String(fd.get("password") || "");

      clearAuthError();
      authState.busy = true;
      render();

      try {
        const { ok, data } = await authRequest("login", { login, password });
        if (!ok || !data?.ok) {
          if (data?.requireVerification) {
            authState.pendingEmail = data.email || login;
            authState.view = "verify";
          } else if (canUseLocalTestCredentials(login, password)) {
            enableLocalTestUser();
          } else {
            setAuthError(data?.error || "Не удалось выполнить вход");
          }
        } else {
          disableLocalTestUser();
          await hydrateAuthSession();
          if (authState.user) {
            await hydrateStateFromRemote();
          }
        }
      } catch (_e) {
        setAuthError("Ошибка сети");
      } finally {
        authState.busy = false;
        render();
      }
    });
  }
}

function wireRenderedHandlers() {
  document
    .querySelectorAll("[data-action='select-todo-project']")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const projectId = button.dataset.projectId;
        if (!projectId || projectId === state.selectedTodoProjectId) return;
        const selectedTask = getSelectedTask();
        if (
          selectedTask &&
          selectedTask.columnId === "todo" &&
          selectedTask.todoProjectId !== projectId
        ) {
          state.selectedTaskId = null;
        }
        state.selectedTodoProjectId = projectId;
        state.creatingInColumn = null;
        state.taskMenuTaskId = null;
        state.todoProjectMenuOpen = false;
        state.creatingSubtaskInTaskId = null;
        state.editingSubtask = null;
        saveState();
        render();
      });
    });

  document.querySelectorAll("[data-action='add-todo-project']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const rawName = window.prompt("Название проекта");
      if (rawName === null) return;
      const project = createTodoProject(rawName);
      if (!project) return;
      state.todoProjects.push(project);
      state.selectedTodoProjectId = project.id;
      state.selectedTaskId = null;
      state.creatingInColumn = null;
      state.taskMenuTaskId = null;
      state.todoProjectMenuOpen = false;
      state.creatingSubtaskInTaskId = null;
      state.editingSubtask = null;
      saveState();
      render();
    });
  });

  document
    .querySelectorAll("[data-action='toggle-todo-project-menu']")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        state.todoProjectMenuOpen = !state.todoProjectMenuOpen;
        state.taskMenuTaskId = null;
        render();
      });
    });

  document.querySelectorAll("[data-action='rename-todo-project']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const project = getActiveTodoProject();
      if (!project) return;
      const rawName = window.prompt("Новое название проекта", project.name);
      if (rawName === null) return;
      const nextName = rawName.trim().replace(/\s+/g, " ").slice(0, 28);
      if (!nextName) return;
      project.name = nextName;
      state.todoProjectMenuOpen = false;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-action='delete-todo-project']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.todoProjects.length <= 1) return;
      const project = getActiveTodoProject();
      if (!project) return;
      const confirmed = window.confirm(
        `Удалить проект «${project.name}» вместе со всеми его задачами?`
      );
      if (!confirmed) return;

      const deletingProjectId = project.id;
      state.todoProjects = state.todoProjects.filter(
        (item) => item.id !== deletingProjectId
      );
      state.tasks = state.tasks.filter(
        (task) =>
          !(task.columnId === "todo" && task.todoProjectId === deletingProjectId)
      );

      if (state.selectedTaskId) {
        const selected = getSelectedTask();
        if (
          selected &&
          selected.columnId === "todo" &&
          selected.todoProjectId === deletingProjectId
        ) {
          state.selectedTaskId = null;
        }
      }

      state.selectedTodoProjectId = resolveSelectedTodoProjectId(
        state.todoProjects,
        state.selectedTodoProjectId
      );
      state.creatingInColumn = null;
      state.creatingSubtaskInTaskId = null;
      state.taskMenuTaskId = null;
      state.todoProjectMenuOpen = false;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-action='toggle-check']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const taskEl = event.currentTarget.closest(".task");
      const task = getTaskById(taskEl.dataset.taskId);
      if (!task) return;
      if (hasSubtasks(task)) {
        const nextCompleted = !task.completed;
        task.subtasks = task.subtasks.map((subtask) => ({
          ...subtask,
          completed: nextCompleted,
        }));
        task.completed = nextCompleted;
      } else {
        task.completed = !task.completed;
      }
      saveState();
      render();
    });
  });

  document.querySelectorAll(".task").forEach((node) => {
    node.addEventListener("click", (event) => {
      const task = getTaskById(node.dataset.taskId);
      if (!task) return;
      if (event.target.closest("[data-action='toggle-checklist']")) return;
      if (event.target.closest("[data-action='toggle-task-menu']")) return;
      if (event.target.closest(".task-menu")) return;
      if (event.target.closest(".edit-input")) return;
      state.selectedTaskId = task.id;
      state.editing = null;
      state.editingSubtask = null;
      state.creatingInColumn = null;
      state.creatingSubtaskInTaskId = null;
      state.taskMenuTaskId = null;
      saveState();
      render();
    });

    node.addEventListener("dblclick", (event) => {
      if (event.target.closest(".checkbox")) return;
      if (event.target.closest(".task-menu")) return;
      if (event.target.closest("[data-action='toggle-checklist']")) return;
      if (event.target.closest("[data-action='toggle-task-menu']")) return;
      if (event.target.closest(".edit-input")) return;
      const task = getTaskById(node.dataset.taskId);
      if (!task) return;
      state.editing = { taskId: task.id };
      state.editingSubtask = null;
      render();
      const input = document.querySelector(".edit-input");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  });

  document.querySelectorAll(".edit-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      const taskEl = event.currentTarget.closest(".task");
      const task = getTaskById(taskEl.dataset.taskId);
      if (!task) return;

      if (event.key === "Enter") {
        updateTaskFromInput(task, input.value);
      } else if (event.key === "Escape") {
        state.editing = null;
        render();
      }
    });

    input.addEventListener("blur", () => {
      state.editing = null;
      render();
    });
  });

  document.querySelectorAll("[data-action='create']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const columnId = event.currentTarget.dataset.columnId;
      state.creatingInColumn = columnId;
      state.editing = null;
      state.editingSubtask = null;
      state.creatingSubtaskInTaskId = null;
      state.taskMenuTaskId = null;
      render();
      const input = document.querySelector(
        `.create-input[data-column-id='${columnId}']`
      );
      if (input) input.focus();
    });
  });

  document.querySelectorAll(".create-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      const columnId = event.currentTarget.dataset.columnId;
      if (event.key === "Enter") {
        createTaskInColumn(columnId, input.value);
      } else if (event.key === "Escape") {
        state.creatingInColumn = null;
        render();
      }
    });

    input.addEventListener("blur", () => {
      state.creatingInColumn = null;
      render();
    });
  });

  document.querySelectorAll("[data-action='toggle-task-menu']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const taskId = button.dataset.taskId;
      state.taskMenuTaskId = state.taskMenuTaskId === taskId ? null : taskId;
      state.creatingInColumn = null;
      state.editing = null;
      state.editingSubtask = null;
      render();
    });

    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  document.querySelectorAll("[data-action='menu-add-checklist']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const task = getTaskById(button.dataset.taskId);
      if (!task) return;
      state.selectedTaskId = task.id;
      state.creatingInColumn = null;
      state.editing = null;
      state.editingSubtask = null;
      state.taskMenuTaskId = null;
      state.creatingSubtaskInTaskId = task.id;
      state.collapsedChecklistTaskIds = state.collapsedChecklistTaskIds.filter(
        (id) => id !== task.id
      );
      render();
      const input = document.querySelector(
        `.subtask-input[data-task-id='${task.id}']`
      );
      if (input) input.focus();
    });
  });

  document.querySelectorAll("[data-action='menu-delete-task']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.taskMenuTaskId = null;
      removeTask(button.dataset.taskId);
    });
  });

  document.querySelectorAll("[data-action='toggle-checklist']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const task = getTaskById(button.dataset.taskId);
      if (!task) return;
      toggleChecklist(task.id);
      state.taskMenuTaskId = null;
      state.editingSubtask = null;
      saveState();
      render();
    });

    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  document.querySelectorAll("[data-action='add-subtask']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const task = getTaskById(button.dataset.taskId);
      if (!task) return;
      state.selectedTaskId = task.id;
      state.creatingInColumn = null;
      state.editing = null;
      state.editingSubtask = null;
      state.taskMenuTaskId = null;
      state.creatingSubtaskInTaskId = task.id;
      state.collapsedChecklistTaskIds = state.collapsedChecklistTaskIds.filter(
        (id) => id !== task.id
      );
      render();
      focusSubtaskInput(task.id);
    });
  });

  document
    .querySelectorAll("[data-action='toggle-subtask-check']")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const task = getTaskById(button.dataset.taskId);
        if (!task || !Array.isArray(task.subtasks)) return;
        const subtask = task.subtasks.find(
          (item) => item.id === button.dataset.subtaskId
        );
        if (!subtask) return;
        subtask.completed = !subtask.completed;
        syncTaskCompletionFromSubtasks(task);
        state.editingSubtask = null;
        saveState();
        render();
      });
    });

  document.querySelectorAll(".subtask-item[data-subtask-id]").forEach((node) => {
    node.addEventListener("dblclick", (event) => {
      if (event.target.closest(".checkbox")) return;
      if (event.target.closest("[data-action='delete-subtask']")) return;
      if (event.target.closest(".subtask-edit-input")) return;
      const parent = node.closest(".subtasks");
      if (!parent) return;
      const task = getTaskById(parent.dataset.parentTaskId);
      if (!task || !Array.isArray(task.subtasks)) return;
      const subtaskId = node.dataset.subtaskId;
      const subtask = task.subtasks.find((item) => item.id === subtaskId);
      if (!subtask) return;
      state.editing = null;
      state.editingSubtask = { taskId: task.id, subtaskId };
      state.creatingSubtaskInTaskId = null;
      render();
      requestAnimationFrame(() => {
        const input = document.querySelector(
          `.subtask-edit-input[data-task-id='${task.id}'][data-subtask-id='${subtaskId}']`
        );
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    });
  });

  document.querySelectorAll("[data-action='delete-subtask']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const task = getTaskById(button.dataset.taskId);
      if (!task || !Array.isArray(task.subtasks)) return;
      task.subtasks = task.subtasks.filter(
        (item) => item.id !== button.dataset.subtaskId
      );
      syncTaskCompletionFromSubtasks(task);
      if (
        state.editingSubtask?.taskId === button.dataset.taskId &&
        state.editingSubtask?.subtaskId === button.dataset.subtaskId
      ) {
        state.editingSubtask = null;
      }
      saveState();
      render();
    });
  });

  document.querySelectorAll(".subtask-edit-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      const task = getTaskById(input.dataset.taskId);
      if (!task || !Array.isArray(task.subtasks)) return;
      const subtask = task.subtasks.find(
        (item) => item.id === input.dataset.subtaskId
      );
      if (!subtask) return;

      if (event.key === "Enter") {
        const value = input.value.trim();
        if (value) {
          subtask.title = value;
          state.editingSubtask = null;
          saveState();
          render();
          return;
        }
        state.editingSubtask = null;
        render();
      } else if (event.key === "Escape") {
        state.editingSubtask = null;
        render();
      }
    });

    input.addEventListener("blur", () => {
      state.editingSubtask = null;
      render();
    });
  });

  document.querySelectorAll(".subtask-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      const task = getTaskById(input.dataset.taskId);
      if (!task) return;

      if (event.key === "Enter") {
        const title = input.value.trim();
        if (title) {
          if (!Array.isArray(task.subtasks)) task.subtasks = [];
          task.subtasks.push(makeSubtask(title));
          syncTaskCompletionFromSubtasks(task);
          state.editingSubtask = null;
          state.creatingSubtaskInTaskId = task.id;
          state.collapsedChecklistTaskIds =
            state.collapsedChecklistTaskIds.filter((id) => id !== task.id);
          saveState();
          render();
          focusSubtaskInput(task.id);
          return;
        }

        state.creatingSubtaskInTaskId = null;
        render();
      } else if (event.key === "Escape") {
        state.creatingSubtaskInTaskId = null;
        render();
      }
    });

    input.addEventListener("blur", () => {
      state.creatingSubtaskInTaskId = null;
      render();
    });
  });

  document.querySelectorAll("[data-action='toggle-todo']").forEach((button) => {
    button.addEventListener("click", () => {
      if (isMobile()) {
        state.mobileTodoOpen = !state.mobileTodoOpen;
      } else {
        state.showTodo = !state.showTodo;
      }
      saveState();
      render();
    });
  });

  document
    .querySelectorAll("[data-action='toggle-todo-modal']")
    .forEach((button) => {
      button.addEventListener("click", () => {
        state.mobileTodoOpen = !state.mobileTodoOpen;
        saveState();
        render();
      });
    });

  document.querySelectorAll("[data-action='shift-day']").forEach((button) => {
    button.addEventListener("click", () => {
      shiftByDayWithAnimation(Number(button.dataset.value));
    });
  });

  document.querySelectorAll("[data-action='shift-week']").forEach((button) => {
    button.addEventListener("click", () => {
      const visibleDays = getVisibleDayCount();
      state.dayOffset += Number(button.dataset.value) * visibleDays;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-action='reset-day']").forEach((button) => {
    button.addEventListener("click", () => {
      resetVisibleDaysToToday();
    });
  });

  document.querySelectorAll("[data-action='play']").forEach((button) => {
    button.addEventListener("click", () => {
      const task = getTaskById(button.dataset.taskId);
      if (!task) return;
      startTask(task);
    });
  });

  document.querySelectorAll("[data-action='pause']").forEach((button) => {
    button.addEventListener("click", () => {
      const task = getTaskById(button.dataset.taskId);
      if (!task) return;
      pauseTask(task);
    });
  });

  document.querySelectorAll("[data-action='stop']").forEach((button) => {
    button.addEventListener("click", () => {
      const task = getTaskById(button.dataset.taskId);
      if (!task) return;
      stopTask(task);
    });
  });

  document.querySelectorAll("[data-action='undo-delete']").forEach((button) => {
    button.addEventListener("click", undoDelete);
  });

  document.querySelectorAll("[data-action='logout']").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await flushRemoteSaveNow();
        await authRequest("logout");
      } catch (_e) {
        // Ignore network errors, local session switch still happens.
      }

      disableLocalTestUser();
      authState.user = null;
      authState.view = "login";
      authState.pendingEmail = "";
      clearAuthError();
      render();
    });
  });

  wireTodoProjectDragAndDrop();
  wireTaskDragAndDrop();
  wireMobileSwipe();
}

function wireTodoProjectDragAndDrop() {
  const projectLists = document.querySelectorAll(".todo-projects-scroll");
  if (!projectLists.length) return;

  let draggedProjectId = null;

  const clearDropMarkers = () => {
    document
      .querySelectorAll(
        ".todo-project.drag-over-before, .todo-project.drag-over-after, .todo-project.dragging-project"
      )
      .forEach((node) => {
        node.classList.remove(
          "drag-over-before",
          "drag-over-after",
          "dragging-project"
        );
      });
  };

  projectLists.forEach((listNode) => {
    listNode
      .querySelectorAll(".todo-project[data-action='select-todo-project'][draggable='true']")
      .forEach((projectNode) => {
        projectNode.addEventListener("dragstart", (event) => {
          draggedProjectId = projectNode.dataset.projectId;
          projectNode.classList.add("dragging-project");
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedProjectId);
          }
        });

        projectNode.addEventListener("dragend", () => {
          clearDropMarkers();
          draggedProjectId = null;
        });
      });

    listNode.addEventListener("dragover", (event) => {
      if (!draggedProjectId) return;
      event.preventDefault();
      clearDropMarkers();

      const targetProject = event.target.closest(
        ".todo-project[data-action='select-todo-project'][draggable='true']"
      );
      if (!targetProject || targetProject.dataset.projectId === draggedProjectId) return;

      const bounds = targetProject.getBoundingClientRect();
      const placeBefore = event.clientX < bounds.left + bounds.width / 2;
      targetProject.classList.add(
        placeBefore ? "drag-over-before" : "drag-over-after"
      );
    });

    listNode.addEventListener("drop", (event) => {
      if (!draggedProjectId) return;
      event.preventDefault();

      const targetProject = event.target.closest(
        ".todo-project[data-action='select-todo-project'][draggable='true']"
      );

      let moved = false;
      if (targetProject && targetProject.dataset.projectId !== draggedProjectId) {
        const bounds = targetProject.getBoundingClientRect();
        const position =
          event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
        moved = moveTodoProjectByDrag(
          draggedProjectId,
          targetProject.dataset.projectId,
          position
        );
      } else {
        moved = moveTodoProjectByDrag(draggedProjectId);
      }

      clearDropMarkers();
      draggedProjectId = null;

      if (!moved) return;
      saveState();
      render();
    });
  });
}

function wireTaskDragAndDrop() {
  const taskLists = [
    ...document.querySelectorAll(".column .task-list"),
    ...document.querySelectorAll(".todo-modal.open .task-list"),
  ];

  if (!taskLists.length) return;

  let draggedTaskId = null;

  const clearDropMarkers = () => {
    document
      .querySelectorAll(".task.drag-over-before, .task.drag-over-after")
      .forEach((node) => {
        node.classList.remove("drag-over-before", "drag-over-after");
      });
    document.querySelectorAll(".task-list.drag-over-list").forEach((node) => {
      node.classList.remove("drag-over-list");
    });
  };

  taskLists.forEach((listNode) => {
    const columnId = listNode.dataset.columnId;
    if (!columnId) return;

    listNode
      .querySelectorAll(".task[data-task-id][draggable='true']")
      .forEach((taskNode) => {
        taskNode.addEventListener("dragstart", (event) => {
          draggedTaskId = taskNode.dataset.taskId;
          taskNode.classList.add("dragging");
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", draggedTaskId);
          }
        });

        taskNode.addEventListener("dragend", () => {
          taskNode.classList.remove("dragging");
          clearDropMarkers();
          draggedTaskId = null;
        });
      });

    listNode.addEventListener("dragover", (event) => {
      if (!draggedTaskId) return;

      event.preventDefault();
      clearDropMarkers();

      const targetTask = event.target.closest(".task[data-task-id][draggable='true']");
      if (!targetTask || targetTask.dataset.taskId === draggedTaskId) {
        listNode.classList.add("drag-over-list");
        return;
      }

      const bounds = targetTask.getBoundingClientRect();
      const placeBefore = event.clientY < bounds.top + bounds.height / 2;
      targetTask.classList.add(placeBefore ? "drag-over-before" : "drag-over-after");
    });

    listNode.addEventListener("dragleave", (event) => {
      if (!draggedTaskId) return;
      if (listNode.contains(event.relatedTarget)) return;
      clearDropMarkers();
    });

    listNode.addEventListener("drop", (event) => {
      if (!draggedTaskId) return;

      event.preventDefault();
      const targetTask = event.target.closest(".task[data-task-id][draggable='true']");

      let moved = false;
      if (targetTask && targetTask.dataset.taskId !== draggedTaskId) {
        const bounds = targetTask.getBoundingClientRect();
        const position =
          event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
        moved = moveTaskByDrag(
          draggedTaskId,
          targetTask.dataset.taskId,
          position,
          columnId
        );
      } else {
        moved = moveTaskByDrag(draggedTaskId, null, "after", columnId);
      }

      if (moved) {
        saveState();
        render();
        return;
      }

      clearDropMarkers();
    });
  });
}

function wireMobileSwipe() {
  const container = document.getElementById("days-container");
  if (!container) return;
  let startX = 0;
  let startY = 0;

  container.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: true }
  );

  container.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      shiftByDayWithAnimation(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

function renderPlayerTime(task) {
  const el = document.querySelector(`[data-player-time='${task.id}']`);
  if (!el) return;
  el.innerHTML = formatTimerHtml(getTaskElapsedSessionSeconds(task));
}

function renderTaskTimes() {
  document.querySelectorAll(".task").forEach((taskNode) => {
    const task = getTaskById(taskNode.dataset.taskId);
    if (!task) return;

    const badge = taskNode.querySelector(".badge");
    if (!badge) return;

    if (!hasTimer(task)) return;
    const progressMinutes = getTaskProgressMinutes(task);
    const showFact = task.actualMinutes > 0 || (hasStartedProgress(task) && progressMinutes > 1);

    if (showFact) {
      badge.textContent = `${formatClockMinutes(progressMinutes)} / ${formatClockMinutes(
        task.plannedMinutes
      )}`;
    } else {
      badge.textContent = formatClockMinutes(task.plannedMinutes);
    }
  });
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
