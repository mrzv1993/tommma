import { computed, ref, watch, type Ref } from 'vue'

import {
  displayProjectTitle,
  PROJECT_STORIES_STORAGE_KEY,
  projectLabelLetters,
  type ProjectBoardState,
  type ProjectStoryItem,
} from '@/app/project-model'

type ProjectStoryStateOptions = {
  collectFinanceProjectMeta: () => [string, { projectName: string }][]
  deletedProjectCardIds: Ref<Record<string, number>>
  deletedProjectSectionIds: Ref<Record<string, number>>
  projectBoardsByProject: Record<string, ProjectBoardState>
  saveProjectBoards: () => void
  selectedProjectKey: Ref<string>
  sidebarSync: {
    markSidebarStateDirty: () => void
  }
}

function markDeletedSidebarId(map: Record<string, number>, id: string, deletedAt: number = Date.now()) {
  if (!id) return
  map[id] = Math.max(map[id] || 0, deletedAt)
}

export function useProjectStoryState(options: ProjectStoryStateOptions) {
  const projectStoriesState = ref<ProjectStoryItem[]>([])
  const deletedProjectStoryKeys = ref<Record<string, number>>({})
  const deleteProjectConfirmOpen = ref(false)
  const renameProjectModalOpen = ref(false)
  const renameProjectDraft = ref('')
  const moveProjectModalOpen = ref(false)
  const moveProjectDraft = ref<ProjectStoryItem[]>([])
  const draggingProjectKey = ref('')
  const draggingStoryKey = ref('')

  const projectStories = computed(() =>
    projectStoriesState.value.map((story) => {
      const cards = options.projectBoardsByProject[story.key]?.cards ?? []
      const totalCardsCount = cards.length
      const completedCardsCount = cards.filter((card) => card.completed).length
      const openCardsCount = totalCardsCount - completedCardsCount
      const progressPercent = totalCardsCount ? Math.round((completedCardsCount / totalCardsCount) * 100) : 0
      return {
        ...story,
        initials: projectLabelLetters(story.name),
        totalCardsCount,
        completedCardsCount,
        openCardsCount,
        openCardsBadge: openCardsCount > 99 ? '99+' : String(openCardsCount),
        progressPercent,
      }
    }),
  )

  const selectedProjectStory = computed(
    () => projectStoriesState.value.find((story) => story.key === options.selectedProjectKey.value) ?? null,
  )

  watch(
    projectStories,
    (stories) => {
      if (!stories.length) {
        options.selectedProjectKey.value = ''
        return
      }
      if (!stories.some((story) => story.key === options.selectedProjectKey.value)) {
        options.selectedProjectKey.value = stories[0].key
      }
    },
    { immediate: true },
  )

  async function addProjectStory() {
    const baseName = `Проект ${projectStoriesState.value.length + 1}`
    const story = {
      key: crypto.randomUUID(),
      name: baseName,
    } satisfies ProjectStoryItem
    projectStoriesState.value.push(story)
    options.selectedProjectKey.value = story.key
    saveProjectStories()
  }

  function openDeleteProjectConfirm() {
    if (!selectedProjectStory.value) return
    deleteProjectConfirmOpen.value = true
  }

  function cancelDeleteProjectConfirm() {
    deleteProjectConfirmOpen.value = false
  }

  function confirmDeleteProject() {
    const target = selectedProjectStory.value
    if (!target) return
    const deletedAt = Date.now()
    markDeletedSidebarId(deletedProjectStoryKeys.value, target.key, deletedAt)
    const board = options.projectBoardsByProject[target.key]
    if (board) {
      for (const section of board.sections) {
        markDeletedSidebarId(options.deletedProjectSectionIds.value, section.id, deletedAt)
      }
      for (const card of board.cards) {
        markDeletedSidebarId(options.deletedProjectCardIds.value, card.id, deletedAt)
      }
    }
    projectStoriesState.value = projectStoriesState.value.filter((story) => story.key !== target.key)
    delete options.projectBoardsByProject[target.key]
    saveProjectStories()
    options.saveProjectBoards()
    deleteProjectConfirmOpen.value = false
  }

  function openRenameProjectModal() {
    const target = selectedProjectStory.value
    if (!target) return
    renameProjectDraft.value = target.name
    renameProjectModalOpen.value = true
  }

  function closeRenameProjectModal() {
    renameProjectModalOpen.value = false
  }

  function submitRenameProject() {
    const target = selectedProjectStory.value
    if (!target) return
    const nextName = renameProjectDraft.value.trim()
    if (!nextName) return
    const story = projectStoriesState.value.find((item) => item.key === target.key)
    if (!story) return
    story.name = nextName
    saveProjectStories()
    renameProjectModalOpen.value = false
  }

  function openMoveProjectModal() {
    moveProjectDraft.value = projectStoriesState.value.map((story) => ({ ...story }))
    moveProjectModalOpen.value = true
  }

  function closeMoveProjectModal() {
    moveProjectModalOpen.value = false
  }

  function handleStoryDragStart(projectKey: string) {
    draggingStoryKey.value = projectKey
  }

  function handleStoryDragEnd() {
    draggingStoryKey.value = ''
  }

  function handleStoryDragOver(event: DragEvent, targetKey: string) {
    event.preventDefault()
    const draggedKey = draggingStoryKey.value
    if (!draggedKey || draggedKey === targetKey) return
    const targetIndex = projectStoriesState.value.findIndex((item) => item.key === targetKey)
    const draggedIndex = projectStoriesState.value.findIndex((item) => item.key === draggedKey)
    if (targetIndex === -1 || draggedIndex === -1) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const before = event.clientX < rect.left + rect.width / 2
    const [dragged] = projectStoriesState.value.splice(draggedIndex, 1)
    const insertIndex = before ? targetIndex : targetIndex + 1
    projectStoriesState.value.splice(insertIndex, 0, dragged)
    saveProjectStories()
  }

  function handleMoveDragStart(projectKey: string) {
    draggingProjectKey.value = projectKey
  }

  function handleMoveDragEnd() {
    draggingProjectKey.value = ''
  }

  function handleMoveDragOver(event: DragEvent, targetKey: string) {
    event.preventDefault()
    const draggedKey = draggingProjectKey.value
    if (!draggedKey || draggedKey === targetKey) return
    const targetIndex = moveProjectDraft.value.findIndex((item) => item.key === targetKey)
    const draggedIndex = moveProjectDraft.value.findIndex((item) => item.key === draggedKey)
    if (targetIndex === -1 || draggedIndex === -1) return

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const before = event.clientY < rect.top + rect.height / 2
    const [dragged] = moveProjectDraft.value.splice(draggedIndex, 1)
    const insertIndex = before ? targetIndex : targetIndex + 1
    moveProjectDraft.value.splice(insertIndex, 0, dragged)
  }

  function saveProjectOrder() {
    projectStoriesState.value = moveProjectDraft.value.map((story) => ({ ...story }))
    saveProjectStories()
    moveProjectModalOpen.value = false
  }

  function collectStoriesFromEarnings() {
    return options.collectFinanceProjectMeta()
      .map(([, meta]) => ({
        key: crypto.randomUUID(),
        name: displayProjectTitle(meta.projectName),
      })) satisfies ProjectStoryItem[]
  }

  function loadProjectStories() {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(window.localStorage.getItem(PROJECT_STORIES_STORAGE_KEY) || '[]')
    } catch {
      parsed = []
    }
    if (Array.isArray(parsed)) {
      const restored = parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const item = entry as Partial<ProjectStoryItem>
          if (typeof item.key !== 'string' || typeof item.name !== 'string') return null
          const name = item.name.trim()
          if (!name) return null
          return { key: item.key, name } satisfies ProjectStoryItem
        })
        .filter((item): item is ProjectStoryItem => item !== null)
      if (restored.length) {
        projectStoriesState.value = restored
        return
      }
    }
    projectStoriesState.value = collectStoriesFromEarnings()
    saveProjectStories()
  }

  function saveProjectStories() {
    window.localStorage.setItem(PROJECT_STORIES_STORAGE_KEY, JSON.stringify(projectStoriesState.value))
    options.sidebarSync.markSidebarStateDirty()
  }

  return {
    addProjectStory,
    cancelDeleteProjectConfirm,
    closeMoveProjectModal,
    closeRenameProjectModal,
    collectStoriesFromEarnings,
    confirmDeleteProject,
    deletedProjectStoryKeys,
    deleteProjectConfirmOpen,
    draggingProjectKey,
    draggingStoryKey,
    handleMoveDragEnd,
    handleMoveDragOver,
    handleMoveDragStart,
    handleStoryDragEnd,
    handleStoryDragOver,
    handleStoryDragStart,
    loadProjectStories,
    moveProjectDraft,
    moveProjectModalOpen,
    openDeleteProjectConfirm,
    openMoveProjectModal,
    openRenameProjectModal,
    projectStories,
    projectStoriesState,
    renameProjectDraft,
    renameProjectModalOpen,
    saveProjectOrder,
    saveProjectStories,
    selectedProjectStory,
    submitRenameProject,
  }
}
