import { computed, ref, type Ref } from 'vue'

import {
  PROJECT_SIDEBAR_LEFT_OFFSET,
  PROJECT_SIDEBAR_LEFT_OFFSET_COLLAPSED,
  PROJECT_SIDEBAR_MAX_WIDTH,
  PROJECT_SIDEBAR_MIN_WIDTH,
  PROJECT_SIDEBAR_WIDTH_STORAGE_KEY,
} from '@/app/project-model'

type ProjectSidebarLayoutStateOptions = {
  appNavCollapsed: Ref<boolean>
}

export function useProjectSidebarLayoutState(options: ProjectSidebarLayoutStateOptions) {
  const projectSidebarWidth = ref(240)

  const projectSidebarLeftPx = computed(() =>
    options.appNavCollapsed.value ? PROJECT_SIDEBAR_LEFT_OFFSET_COLLAPSED : PROJECT_SIDEBAR_LEFT_OFFSET,
  )
  const projectSidebarInlineStyle = computed(() => ({
    width: `${projectSidebarWidth.value}px`,
    left: `${projectSidebarLeftPx.value}px`,
  }))
  const boardOffsetPx = computed(() => projectSidebarLeftPx.value + projectSidebarWidth.value)
  const boardInlineStyle = computed(() => ({ marginLeft: `${boardOffsetPx.value}px` }))
  const notesInlineStyle = computed(() => ({ marginLeft: `${options.appNavCollapsed.value ? 16 : 88}px` }))

  function loadProjectSidebarWidth() {
    const raw = window.localStorage.getItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY)
    const width = Number(raw)
    if (!Number.isFinite(width)) return
    projectSidebarWidth.value = Math.max(PROJECT_SIDEBAR_MIN_WIDTH, Math.min(PROJECT_SIDEBAR_MAX_WIDTH, width))
  }

  function saveProjectSidebarWidth() {
    window.localStorage.setItem(PROJECT_SIDEBAR_WIDTH_STORAGE_KEY, String(projectSidebarWidth.value))
  }

  function startSidebarResize(event: MouseEvent) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = projectSidebarWidth.value

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const next = startWidth + delta
      projectSidebarWidth.value = Math.max(PROJECT_SIDEBAR_MIN_WIDTH, Math.min(PROJECT_SIDEBAR_MAX_WIDTH, next))
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      saveProjectSidebarWidth()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return {
    boardInlineStyle,
    boardOffsetPx,
    loadProjectSidebarWidth,
    notesInlineStyle,
    projectSidebarInlineStyle,
    projectSidebarLeftPx,
    projectSidebarWidth,
    saveProjectSidebarWidth,
    startSidebarResize,
  }
}
