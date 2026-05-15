import { inject, provide, reactive, type Ref, type UnwrapNestedRefs } from 'vue'

import type { useProjectBoardState } from '@/app/project-board-state'
import type { useProjectCardDndState } from '@/app/project-card-dnd-state'
import type { ROOT_SECTION_INSERT_TARGET } from '@/app/project-model'
import type { useProjectSidebarLayoutState } from '@/app/project-sidebar-layout-state'
import type { useProjectStoryState } from '@/app/project-story-state'

type ProjectBoardState = ReturnType<typeof useProjectBoardState>
type ProjectDndState = ReturnType<typeof useProjectCardDndState>
type ProjectLayoutState = ReturnType<typeof useProjectSidebarLayoutState>
type ProjectStoryState = ReturnType<typeof useProjectStoryState>

export type ProjectSidebarContextSource = Pick<
  ProjectBoardState,
  | 'addCard'
  | 'addCardEditing'
  | 'addProjectCard'
  | 'addSection'
  | 'cancelAddCardEdit'
  | 'cancelAddProjectCardEdit'
  | 'cancelAddSectionEdit'
  | 'cardDraftBySection'
  | 'cardMenuOpenId'
  | 'cardsForSection'
  | 'closeMenuOnBlur'
  | 'deleteCard'
  | 'editingCardDraft'
  | 'editingCardId'
  | 'editingSectionDraft'
  | 'editingSectionId'
  | 'handleAddCardBlur'
  | 'handleAddProjectCardBlur'
  | 'handleAddSectionBlur'
  | 'openDeleteSectionConfirm'
  | 'sectionAddRowProps'
  | 'sectionDraftByProject'
  | 'sectionMenuOpenId'
  | 'selectedProjectHasNoSections'
  | 'selectedProjectProgressPercent'
  | 'selectedProjectRootCards'
  | 'selectedProjectRootSectionId'
  | 'selectedProjectSections'
  | 'startAddCardEdit'
  | 'startAddProjectCardEdit'
  | 'startAddSectionEdit'
  | 'startCardRename'
  | 'startCardRenameByDoubleClick'
  | 'startSectionRename'
  | 'startSectionRenameByDoubleClick'
  | 'submitCardRename'
  | 'submitSectionRename'
  | 'toggleCardCompleted'
  | 'toggleCardMenu'
  | 'toggleSectionMenu'
> &
  Pick<
    ProjectDndState,
    | 'cardRowDropClass'
    | 'draggingCardId'
    | 'handleCardDragEnd'
    | 'handleCardDragOver'
    | 'handleCardDragStart'
    | 'handleCardDrop'
    | 'handleCardListDragLeave'
    | 'isCardDropContainerTarget'
  > &
  Pick<
    ProjectStoryState,
    | 'addProjectStory'
    | 'handleStoryDragEnd'
    | 'handleStoryDragOver'
    | 'handleStoryDragStart'
    | 'openDeleteProjectConfirm'
    | 'openMoveProjectModal'
    | 'openRenameProjectModal'
    | 'projectStories'
    | 'selectedProjectStory'
  > &
  Pick<ProjectLayoutState, 'projectSidebarInlineStyle' | 'startSidebarResize'> & {
    ROOT_SECTION_INSERT_TARGET: typeof ROOT_SECTION_INSERT_TARGET
    selectedProjectKey: Ref<string>
  }

export type ProjectSidebarContext = UnwrapNestedRefs<ProjectSidebarContextSource>

const PROJECT_SIDEBAR_CONTEXT_KEY = Symbol('ProjectSidebarContext')

export function provideProjectSidebarContext(context: ProjectSidebarContextSource) {
  provide(PROJECT_SIDEBAR_CONTEXT_KEY, reactive(context))
}

export function useProjectSidebarContext() {
  const context = inject<ProjectSidebarContext>(PROJECT_SIDEBAR_CONTEXT_KEY)
  if (!context) {
    throw new Error('Project sidebar context is not available')
  }
  return context
}
