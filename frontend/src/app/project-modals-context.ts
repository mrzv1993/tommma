import { inject, provide, reactive, type UnwrapNestedRefs } from 'vue'

import type { useProjectBoardState } from '@/app/project-board-state'
import type { useProjectStoryState } from '@/app/project-story-state'

type ProjectBoardState = ReturnType<typeof useProjectBoardState>
type ProjectStoryState = ReturnType<typeof useProjectStoryState>

export type ProjectModalsContextSource = Pick<
  ProjectBoardState,
  'cancelDeleteSectionConfirm' | 'confirmDeleteSection' | 'deleteSectionConfirmOpen'
> &
  Pick<
    ProjectStoryState,
    | 'cancelDeleteProjectConfirm'
    | 'closeMoveProjectModal'
    | 'closeRenameProjectModal'
    | 'confirmDeleteProject'
    | 'deleteProjectConfirmOpen'
    | 'draggingProjectKey'
    | 'handleMoveDragEnd'
    | 'handleMoveDragOver'
    | 'handleMoveDragStart'
    | 'moveProjectDraft'
    | 'moveProjectModalOpen'
    | 'renameProjectDraft'
    | 'renameProjectModalOpen'
    | 'saveProjectOrder'
    | 'submitRenameProject'
  >

export type ProjectModalsContext = UnwrapNestedRefs<ProjectModalsContextSource>

const PROJECT_MODALS_CONTEXT_KEY = Symbol('ProjectModalsContext')

export function provideProjectModalsContext(context: ProjectModalsContextSource) {
  provide(PROJECT_MODALS_CONTEXT_KEY, reactive(context))
}

export function useProjectModalsContext() {
  const context = inject<ProjectModalsContext>(PROJECT_MODALS_CONTEXT_KEY)
  if (!context) {
    throw new Error('Project modals context is not available')
  }
  return context
}
