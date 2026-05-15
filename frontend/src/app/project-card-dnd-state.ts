import { ref, type ComputedRef } from 'vue'

import type { ProjectBoardState } from '@/app/project-model'

type ProjectCardDndStateOptions = {
  saveProjectBoards: () => void
  selectedProjectBoard: ComputedRef<ProjectBoardState | null>
}

export function useProjectCardDndState(options: ProjectCardDndStateOptions) {
  const draggingCardId = ref('')
  const cardDropSectionId = ref('')
  const cardDropTargetId = ref('')
  const cardDropBefore = ref(false)

  function handleCardDragStart(event: DragEvent, cardId: string) {
    draggingCardId.value = cardId
    cardDropTargetId.value = ''
    cardDropSectionId.value = ''
    cardDropBefore.value = false
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', cardId)
    }
  }

  function handleCardDragEnd() {
    draggingCardId.value = ''
    cardDropTargetId.value = ''
    cardDropSectionId.value = ''
    cardDropBefore.value = false
  }

  function normalizeSectionCardPositions(board: ProjectBoardState, sectionId: string) {
    board.cards
      .filter((card) => card.sectionId === sectionId)
      .sort((a, b) => a.position - b.position)
      .forEach((card, index) => {
        card.position = index
      })
  }

  function moveCardToDropTarget(
    board: ProjectBoardState,
    cardId: string,
    sectionId: string,
    targetCardId: string | null,
    before: boolean,
  ) {
    const dragged = board.cards.find((card) => card.id === cardId)
    if (!dragged) return false
    const fromSectionId = dragged.sectionId
    const previousPosition = dragged.position

    if (!targetCardId) {
      dragged.sectionId = sectionId
      const targetCards = board.cards
        .filter((card) => card.sectionId === sectionId && card.id !== dragged.id)
        .sort((a, b) => a.position - b.position)
      targetCards.push(dragged)
      targetCards.forEach((card, index) => {
        card.position = index
      })
      if (fromSectionId !== sectionId) {
        normalizeSectionCardPositions(board, fromSectionId)
      }
      return fromSectionId !== sectionId || previousPosition !== dragged.position
    }

    const target = board.cards.find((card) => card.id === targetCardId)
    if (!target || target.id === dragged.id) return false
    const toSectionId = target.sectionId
    const targetCards = board.cards
      .filter((card) => card.sectionId === toSectionId && card.id !== dragged.id)
      .sort((a, b) => a.position - b.position)
    const targetIndex = targetCards.findIndex((card) => card.id === target.id)
    if (targetIndex === -1) return false
    const insertIndex = before ? targetIndex : targetIndex + 1
    dragged.sectionId = toSectionId
    targetCards.splice(insertIndex, 0, dragged)
    targetCards.forEach((card, index) => {
      card.position = index
    })
    if (fromSectionId !== toSectionId) {
      normalizeSectionCardPositions(board, fromSectionId)
    }
    return fromSectionId !== toSectionId || previousPosition !== dragged.position
  }

  function updateCardDropTarget(event: DragEvent, sectionId: string, targetCardId: string | null = null) {
    const draggedCardId = draggingCardId.value
    if (!draggedCardId) return
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    cardDropSectionId.value = sectionId
    cardDropTargetId.value = targetCardId ?? ''
    if (!targetCardId) {
      cardDropBefore.value = false
      return
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    cardDropBefore.value = event.clientY < rect.top + rect.height / 2
  }

  function handleCardDragOver(event: DragEvent, sectionId: string, targetCardId: string | null = null) {
    event.preventDefault()
    updateCardDropTarget(event, sectionId, targetCardId)
  }

  function handleCardDrop(event: DragEvent, sectionId: string, targetCardId: string | null = null) {
    event.preventDefault()
    const board = options.selectedProjectBoard.value
    const draggedCardId = draggingCardId.value
    if (!board || !draggedCardId) return
    updateCardDropTarget(event, sectionId, targetCardId)
    const changed = moveCardToDropTarget(
      board,
      draggedCardId,
      cardDropSectionId.value || sectionId,
      cardDropTargetId.value || null,
      cardDropBefore.value,
    )
    if (changed) {
      options.saveProjectBoards()
    }
    handleCardDragEnd()
  }

  function isCardDropContainerTarget(sectionId: string) {
    return cardDropSectionId.value === sectionId && !cardDropTargetId.value
  }

  function cardRowDropClass(cardId: string) {
    if (cardDropTargetId.value !== cardId) return ''
    return cardDropBefore.value ? 'project-card-row-drop-before' : 'project-card-row-drop-after'
  }

  function handleCardListDragLeave(event: DragEvent, sectionId: string) {
    const nextTarget = event.relatedTarget as Node | null
    if (nextTarget && (event.currentTarget as HTMLElement).contains(nextTarget)) return
    if (cardDropSectionId.value === sectionId && !cardDropTargetId.value) {
      cardDropSectionId.value = ''
    }
  }

  return {
    cardDropBefore,
    cardDropSectionId,
    cardDropTargetId,
    cardRowDropClass,
    draggingCardId,
    handleCardDragEnd,
    handleCardDragOver,
    handleCardDragStart,
    handleCardDrop,
    handleCardListDragLeave,
    isCardDropContainerTarget,
    moveCardToDropTarget,
    normalizeSectionCardPositions,
    updateCardDropTarget,
  }
}
