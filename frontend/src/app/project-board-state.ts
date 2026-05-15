import { computed, nextTick, reactive, ref, type Ref } from 'vue'

import {
  type CardItem,
  type ProjectBoardState,
  PROJECT_BOARDS_STORAGE_KEY,
  PROJECT_TASKS_STORAGE_KEY,
  type ProjectTaskItem,
  rootSectionId,
  ROOT_SECTION_INSERT_TARGET,
  type SectionItem,
} from '@/app/project-model'

type ProjectBoardStateOptions = {
  sidebarSync: {
    markSidebarStateDirty: () => void
  }
  selectedProjectKey: Ref<string>
}

function markDeletedSidebarId(map: Record<string, number>, id: string, deletedAt: number = Date.now()) {
  if (!id) return
  map[id] = Math.max(map[id] || 0, deletedAt)
}

export function useProjectBoardState(options: ProjectBoardStateOptions) {
  const projectBoardsByProject = reactive<Record<string, ProjectBoardState>>({})
  const sectionDraftByProject = reactive<Record<string, string>>({})
  const cardDraftBySection = reactive<Record<string, string>>({})
  const addSectionEditing = reactive<Record<string, boolean>>({})
  const sectionInsertAnchorByProject = reactive<Record<string, string>>({})
  const addCardEditing = reactive<Record<string, boolean>>({})
  const sectionMenuOpenId = ref('')
  const cardMenuOpenId = ref('')
  const editingSectionId = ref('')
  const editingSectionDraft = ref('')
  const editingCardId = ref('')
  const editingCardDraft = ref('')
  const deleteSectionConfirmOpen = ref(false)
  const pendingDeleteSectionId = ref('')
  const deletedProjectSectionIds = ref<Record<string, number>>({})
  const deletedProjectCardIds = ref<Record<string, number>>({})

  const selectedProjectBoard = computed(() => {
    const selected = options.selectedProjectKey.value
    if (!selected) return null
    return ensureProjectBoard(selected)
  })

  const selectedProjectProgressPercent = computed(() => {
    const cards = selectedProjectBoard.value?.cards ?? []
    if (!cards.length) return 0
    const completed = cards.filter((card) => card.completed).length
    return Math.round((completed / cards.length) * 100)
  })

  const selectedProjectSections = computed(() =>
    [...(selectedProjectBoard.value?.sections ?? [])].sort((a, b) => a.position - b.position),
  )
  const selectedProjectRootSectionId = computed(() =>
    options.selectedProjectKey.value ? rootSectionId(options.selectedProjectKey.value) : '',
  )
  const selectedProjectRootCards = computed(() => {
    const sectionId = selectedProjectRootSectionId.value
    if (!sectionId) return []
    return cardsForSection(sectionId)
  })
  const selectedProjectHasNoSections = computed(() =>
    Boolean(options.selectedProjectKey.value) && selectedProjectSections.value.length === 0,
  )

  function ensureProjectBoard(projectKey: string): ProjectBoardState {
    if (!projectBoardsByProject[projectKey]) {
      projectBoardsByProject[projectKey] = {
        sections: [],
        cards: [],
      }
    }
    return projectBoardsByProject[projectKey]
  }

  function saveProjectBoards() {
    window.localStorage.setItem(PROJECT_BOARDS_STORAGE_KEY, JSON.stringify(projectBoardsByProject))
    options.sidebarSync.markSidebarStateDirty()
  }

  function cardsForSection(sectionId: string) {
    const board = selectedProjectBoard.value
    if (!board) return []
    return board.cards.filter((card) => card.sectionId === sectionId).sort((a, b) => a.position - b.position)
  }

  function addSection() {
    const projectKey = options.selectedProjectKey.value
    if (!projectKey) return
    const title = (sectionDraftByProject[projectKey] || '').trim()
    if (!title) return
    const board = ensureProjectBoard(projectKey)
    const now = new Date().toISOString()
    const nextSection: SectionItem = {
      id: crypto.randomUUID(),
      boardId: projectKey,
      title,
      position: 0,
      createdAt: now,
      updatedAt: now,
    }
    const anchor = sectionInsertAnchorByProject[projectKey] || ROOT_SECTION_INSERT_TARGET
    const orderedSections = [...board.sections].sort((a, b) => a.position - b.position)
    let insertIndex = 0
    if (anchor !== ROOT_SECTION_INSERT_TARGET) {
      const anchorIndex = orderedSections.findIndex((section) => section.id === anchor)
      insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : orderedSections.length
    }
    orderedSections.splice(insertIndex, 0, nextSection)
    board.sections = orderedSections.map((section, index) => ({
      ...section,
      position: index,
    }))
    sectionDraftByProject[projectKey] = ''
    addSectionEditing[projectKey] = true
    sectionInsertAnchorByProject[projectKey] = nextSection.id
    saveProjectBoards()
    void nextTick().then(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-add-section-input="${projectKey}"]`)
      input?.focus()
    })
  }

  function startAddSectionEdit(anchor: string = ROOT_SECTION_INSERT_TARGET) {
    const projectKey = options.selectedProjectKey.value
    if (!projectKey) return
    addSectionEditing[projectKey] = true
    sectionInsertAnchorByProject[projectKey] = anchor
    void nextTick().then(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-add-section-input="${projectKey}"]`)
      input?.focus()
    })
  }

  function handleAddSectionBlur(projectKey: string) {
    if ((sectionDraftByProject[projectKey] || '').trim()) return
    addSectionEditing[projectKey] = false
    delete sectionInsertAnchorByProject[projectKey]
  }

  function cancelAddSectionEdit(projectKey: string, event: KeyboardEvent) {
    sectionDraftByProject[projectKey] = ''
    addSectionEditing[projectKey] = false
    delete sectionInsertAnchorByProject[projectKey]
    const target = event.target as HTMLInputElement | null
    target?.blur()
  }

  function sectionAddRowProps(projectKey: string, anchor: string) {
    const currentAnchor = sectionInsertAnchorByProject[projectKey] || ROOT_SECTION_INSERT_TARGET
    const editing = Boolean(addSectionEditing[projectKey]) && currentAnchor === anchor
    return {
      hasValue: editing || (currentAnchor === anchor && Boolean((sectionDraftByProject[projectKey] || '').trim())),
      editing,
    }
  }

  function toggleSectionMenu(sectionId: string, event: MouseEvent) {
    const nextValue = sectionMenuOpenId.value === sectionId ? '' : sectionId
    sectionMenuOpenId.value = nextValue
    cardMenuOpenId.value = ''
    if (!nextValue) return
    const menuWrap = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.project-item-menu-wrap')
    void nextTick().then(() => {
      menuWrap?.focus()
    })
  }

  function toggleCardMenu(cardId: string, event: MouseEvent) {
    const nextValue = cardMenuOpenId.value === cardId ? '' : cardId
    cardMenuOpenId.value = nextValue
    sectionMenuOpenId.value = ''
    if (!nextValue) return
    const menuWrap = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('.project-item-menu-wrap')
    void nextTick().then(() => {
      menuWrap?.focus()
    })
  }

  function closeMenuOnBlur(kind: 'section' | 'card', id: string, event: FocusEvent) {
    const currentTarget = event.currentTarget as HTMLElement | null
    const nextTarget = event.relatedTarget as Node | null
    if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) return
    if (kind === 'section' && sectionMenuOpenId.value === id) {
      sectionMenuOpenId.value = ''
    }
    if (kind === 'card' && cardMenuOpenId.value === id) {
      cardMenuOpenId.value = ''
    }
  }

  function startSectionRename(section: SectionItem) {
    editingSectionId.value = section.id
    editingSectionDraft.value = section.title
    sectionMenuOpenId.value = ''
  }

  function startSectionRenameByDoubleClick(section: SectionItem) {
    startSectionRename(section)
  }

  function submitSectionRename() {
    const board = selectedProjectBoard.value
    if (!board || !editingSectionId.value) return
    const title = editingSectionDraft.value.trim()
    if (!title) return
    const target = board.sections.find((item) => item.id === editingSectionId.value)
    if (!target) return
    target.title = title
    target.updatedAt = new Date().toISOString()
    editingSectionId.value = ''
    editingSectionDraft.value = ''
    saveProjectBoards()
  }

  function openDeleteSectionConfirm(sectionId: string) {
    pendingDeleteSectionId.value = sectionId
    deleteSectionConfirmOpen.value = true
    sectionMenuOpenId.value = ''
  }

  function cancelDeleteSectionConfirm() {
    deleteSectionConfirmOpen.value = false
    pendingDeleteSectionId.value = ''
  }

  function confirmDeleteSection() {
    const board = selectedProjectBoard.value
    if (!board || !pendingDeleteSectionId.value) return
    const sectionId = pendingDeleteSectionId.value
    const deletedAt = Date.now()
    markDeletedSidebarId(deletedProjectSectionIds.value, sectionId, deletedAt)
    for (const card of board.cards.filter((item) => item.sectionId === sectionId)) {
      markDeletedSidebarId(deletedProjectCardIds.value, card.id, deletedAt)
    }
    board.sections = board.sections
      .filter((section) => section.id !== sectionId)
      .map((section, index) => ({ ...section, position: index }))
    board.cards = board.cards.filter((card) => card.sectionId !== sectionId)
    deleteSectionConfirmOpen.value = false
    pendingDeleteSectionId.value = ''
    saveProjectBoards()
  }

  function addCard(sectionId: string) {
    const board = selectedProjectBoard.value
    if (!board) return
    const title = (cardDraftBySection[sectionId] || '').trim()
    if (!title) return
    const now = new Date().toISOString()
    const cardsInSection = board.cards.filter((card) => card.sectionId === sectionId)
    board.cards.push({
      id: crypto.randomUUID(),
      sectionId,
      title,
      completed: false,
      position: cardsInSection.length,
      createdAt: now,
      updatedAt: now,
    })
    cardDraftBySection[sectionId] = ''
    addCardEditing[sectionId] = true
    saveProjectBoards()
    void nextTick().then(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-add-card-input="${sectionId}"]`)
      input?.focus()
    })
  }

  function startAddCardEdit(sectionId: string) {
    addCardEditing[sectionId] = true
    void nextTick().then(() => {
      const input = document.querySelector<HTMLInputElement>(`input[data-add-card-input="${sectionId}"]`)
      input?.focus()
    })
  }

  function addProjectCard() {
    const sectionId = selectedProjectRootSectionId.value
    if (!sectionId) return
    addCard(sectionId)
  }

  function startAddProjectCardEdit() {
    const sectionId = selectedProjectRootSectionId.value
    if (!sectionId) return
    startAddCardEdit(sectionId)
  }

  function handleAddProjectCardBlur() {
    const sectionId = selectedProjectRootSectionId.value
    if (!sectionId) return
    handleAddCardBlur(sectionId)
  }

  function cancelAddProjectCardEdit(event: KeyboardEvent) {
    const sectionId = selectedProjectRootSectionId.value
    if (!sectionId) return
    cancelAddCardEdit(sectionId, event)
  }

  function handleAddCardBlur(sectionId: string) {
    if ((cardDraftBySection[sectionId] || '').trim()) return
    addCardEditing[sectionId] = false
  }

  function cancelAddCardEdit(sectionId: string, event: KeyboardEvent) {
    cardDraftBySection[sectionId] = ''
    addCardEditing[sectionId] = false
    const target = event.target as HTMLInputElement | null
    target?.blur()
  }

  function startCardRename(card: CardItem) {
    editingCardId.value = card.id
    editingCardDraft.value = card.title
    cardMenuOpenId.value = ''
  }

  function startCardRenameByDoubleClick(card: CardItem) {
    startCardRename(card)
  }

  function submitCardRename() {
    const board = selectedProjectBoard.value
    if (!board || !editingCardId.value) return
    const title = editingCardDraft.value.trim()
    if (!title) return
    const target = board.cards.find((item) => item.id === editingCardId.value)
    if (!target) return
    target.title = title
    target.updatedAt = new Date().toISOString()
    editingCardId.value = ''
    editingCardDraft.value = ''
    saveProjectBoards()
  }

  function toggleCardCompleted(cardId: string) {
    const board = selectedProjectBoard.value
    if (!board) return
    const target = board.cards.find((item) => item.id === cardId)
    if (!target) return
    target.completed = !target.completed
    target.updatedAt = new Date().toISOString()
    saveProjectBoards()
  }

  function deleteCard(cardId: string) {
    const board = selectedProjectBoard.value
    if (!board) return
    const target = board.cards.find((card) => card.id === cardId)
    if (!target) return
    markDeletedSidebarId(deletedProjectCardIds.value, target.id)
    board.cards = board.cards.filter((card) => card.id !== cardId)
    const updated = board.cards
      .filter((card) => card.sectionId === target.sectionId)
      .sort((a, b) => a.position - b.position)
    updated.forEach((card, index) => {
      card.position = index
    })
    cardMenuOpenId.value = ''
    saveProjectBoards()
  }

  function loadProjectBoards() {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(window.localStorage.getItem(PROJECT_BOARDS_STORAGE_KEY) || '{}')
    } catch {
      parsed = {}
    }

    for (const key of Object.keys(projectBoardsByProject)) {
      delete projectBoardsByProject[key]
    }

    if (!parsed || typeof parsed !== 'object') return
    const source = parsed as Record<string, unknown>
    for (const [projectKey, rawBoard] of Object.entries(source)) {
      if (!rawBoard || typeof rawBoard !== 'object') continue
      const board = rawBoard as { sections?: unknown; cards?: unknown }
      const sections = Array.isArray(board.sections)
        ? board.sections
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null
              const item = entry as Partial<SectionItem>
              if (typeof item.id !== 'string' || typeof item.boardId !== 'string' || typeof item.title !== 'string') return null
              return {
                id: item.id,
                boardId: item.boardId,
                title: item.title,
                position: Number(item.position ?? 0),
                createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
                updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
              } satisfies SectionItem
            })
            .filter((item): item is SectionItem => item !== null)
        : []
      const sectionIds = new Set(sections.map((section) => section.id))
      const rootSection = rootSectionId(projectKey)
      const cards = Array.isArray(board.cards)
        ? board.cards
            .map((entry) => {
              if (!entry || typeof entry !== 'object') return null
              const item = entry as Partial<CardItem>
              if (typeof item.id !== 'string' || typeof item.sectionId !== 'string' || typeof item.title !== 'string') return null
              if (!sectionIds.has(item.sectionId) && item.sectionId !== rootSection) return null
              return {
                id: item.id,
                sectionId: item.sectionId,
                title: item.title,
                completed: Boolean(item.completed),
                position: Number(item.position ?? 0),
                createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
                updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
              } satisfies CardItem
            })
            .filter((item): item is CardItem => item !== null)
        : []
      projectBoardsByProject[projectKey] = { sections, cards }
    }

    if (!Object.keys(projectBoardsByProject).length) {
      // Backward compatibility with the previous project tasks storage.
      try {
        const legacyParsed = JSON.parse(window.localStorage.getItem(PROJECT_TASKS_STORAGE_KEY) || '{}') as Record<
          string,
          ProjectTaskItem[]
        >
        for (const [projectKey, tasks] of Object.entries(legacyParsed)) {
          if (!Array.isArray(tasks) || !tasks.length) continue
          const sectionId = crypto.randomUUID()
          const now = new Date().toISOString()
          projectBoardsByProject[projectKey] = {
            sections: [
              {
                id: sectionId,
                boardId: projectKey,
                title: 'Раздел 1',
                position: 0,
                createdAt: now,
                updatedAt: now,
              },
            ],
            cards: tasks.map((task, index) => ({
              id: task.id || crypto.randomUUID(),
              sectionId,
              title: task.title,
              completed: Boolean(task.completed),
              position: index,
              createdAt: new Date(task.createdAt || Date.now()).toISOString(),
              updatedAt: now,
            })),
          }
        }
        saveProjectBoards()
      } catch {
        // ignore migration errors
      }
    }
  }

  return {
    addCard,
    addCardEditing,
    addProjectCard,
    addSection,
    addSectionEditing,
    cancelAddCardEdit,
    cancelAddProjectCardEdit,
    cancelAddSectionEdit,
    cancelDeleteSectionConfirm,
    cardDraftBySection,
    cardMenuOpenId,
    cardsForSection,
    closeMenuOnBlur,
    confirmDeleteSection,
    deleteCard,
    deletedProjectCardIds,
    deletedProjectSectionIds,
    deleteSectionConfirmOpen,
    editingCardDraft,
    editingCardId,
    editingSectionDraft,
    editingSectionId,
    ensureProjectBoard,
    handleAddCardBlur,
    handleAddProjectCardBlur,
    handleAddSectionBlur,
    loadProjectBoards,
    openDeleteSectionConfirm,
    pendingDeleteSectionId,
    projectBoardsByProject,
    saveProjectBoards,
    sectionAddRowProps,
    sectionDraftByProject,
    sectionInsertAnchorByProject,
    sectionMenuOpenId,
    selectedProjectBoard,
    selectedProjectHasNoSections,
    selectedProjectProgressPercent,
    selectedProjectRootCards,
    selectedProjectRootSectionId,
    selectedProjectSections,
    startAddCardEdit,
    startAddProjectCardEdit,
    startAddSectionEdit,
    startCardRename,
    startCardRenameByDoubleClick,
    startSectionRename,
    startSectionRenameByDoubleClick,
    submitCardRename,
    submitSectionRename,
    toggleCardCompleted,
    toggleCardMenu,
    toggleSectionMenu,
  }
}
