import { inject, provide, type InjectionKey } from 'vue'
import type { useAppState } from '@/lib/app-state'
type FocusBoard = ReturnType<typeof useAppState>
const key: InjectionKey<FocusBoard> = Symbol('TaskFocus')
export const provideTaskFocus = (board: FocusBoard) => provide(key, board)
export const useTaskFocus = () => inject(key, null)
