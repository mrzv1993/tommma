<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowDownUp, ArrowRight, Plus, ShoppingCart, X } from '@lucide/vue'
import type { NormalizedOperationInput, Operation, OperationType, ReferenceData } from '@capital/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import OperationForm from './OperationForm.vue'

const props = defineProps<{
  references: ReferenceData
  saving: boolean
  disabled?: boolean
  editOperation?: Operation | null
  openType?: OperationType | null
  onSave: (input: NormalizedOperationInput, id?: string, allowDuplicate?: boolean, confirmReview?: boolean) => Promise<'saved' | 'duplicate' | 'failed'>
}>()
const emit = defineEmits<{ closeEdit: []; openHandled: [] }>()
const root = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const menuPinned = ref(false)
const sheetOpen = ref(false)
const selectedType = ref<OperationType>('purchase')
const pendingReview = ref(false)
let returnFocus: HTMLElement | null = null
const pendingDuplicate = ref<NormalizedOperationInput | null>(null)
let closeTimer: ReturnType<typeof setTimeout> | null = null

const actions: Array<{ type: OperationType; label: string; icon: typeof Plus }> = [
  { type: 'purchase', label: 'Покупка', icon: ShoppingCart },
  { type: 'conversion', label: 'Конвертация', icon: ArrowDownUp },
  { type: 'transfer', label: 'Перевод', icon: ArrowRight },
]

watch(
  () => props.editOperation,
  (operation) => {
    if (operation) {
      returnFocus = document.activeElement as HTMLElement
      selectedType.value = operation.type
      sheetOpen.value = true
    }
  },
)
watch(
  () => props.openType,
  (type) => {
    if (type) {
      choose(type)
      emit('openHandled')
    }
  },
)
watch(sheetOpen, (open) => {
  if (!open) { emit('closeEdit'); returnFocus?.focus() }
})

function openMenu() {
  if (props.disabled) return
  if (closeTimer) clearTimeout(closeTimer)
  menuOpen.value = true
}
function scheduleClose() {
  if (!menuPinned.value)
    closeTimer = setTimeout(() => {
      menuOpen.value = false
    }, 140)
}
function choose(type: OperationType) {
  if (props.disabled) return
  returnFocus = document.activeElement as HTMLElement
  selectedType.value = type
  menuOpen.value = false
  menuPinned.value = false
  sheetOpen.value = true
}
function onFocusOut(event: FocusEvent) {
  if (!root.value?.contains(event.relatedTarget as Node)) scheduleClose()
}
function onPointerDown(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) {
    menuOpen.value = false
    menuPinned.value = false
  }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    menuOpen.value = false
    menuPinned.value = false
  }
}
function toggleMenu() {
  if (menuPinned.value) {
    menuOpen.value = false
    menuPinned.value = false
  } else {
    menuOpen.value = true
    menuPinned.value = true
  }
}
async function handleSubmit(input: NormalizedOperationInput, confirmReview = false) {
  pendingReview.value = confirmReview
  const result = await props.onSave(input, props.editOperation?.id, false, confirmReview)
  if (result === 'saved') sheetOpen.value = false
  if (result === 'duplicate') pendingDuplicate.value = input
}
async function saveDuplicate() {
  if (!pendingDuplicate.value) return
  const result = await props.onSave(pendingDuplicate.value, props.editOperation?.id, true, pendingReview.value)
  if (result === 'saved') {
    pendingDuplicate.value = null
    sheetOpen.value = false
  }
}
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
  if (closeTimer) clearTimeout(closeTimer)
})
</script>

<template>
  <div
    ref="root"
    class="fixed bottom-6 right-6 flex flex-col items-end gap-2"
    @mouseenter="openMenu"
    @mouseleave="scheduleClose"
    @focusin="openMenu"
    @focusout="onFocusOut"
  >
    <TransitionGroup name="fab">
      <Button
        v-for="action in menuOpen ? actions : []"
        :key="action.type"
        variant="outline"
        class="min-h-11 justify-start bg-background shadow-lg"
        @click="choose(action.type)"
      >
        <component :is="action.icon" data-icon="inline-start" />{{ action.label }}
      </Button>
    </TransitionGroup>
    <Button
      size="icon-lg"
      class="size-14 rounded-full shadow-xl"
      :aria-expanded="menuOpen"
      aria-label="Добавить операцию"
      :disabled="disabled"
      @click.stop="toggleMenu"
    >
      <X v-if="menuOpen" /><Plus v-else />
    </Button>
  </div>

  <Sheet v-model:open="sheetOpen">
    <SheetContent class="flex w-full flex-col p-0 sm:max-w-xl data-[side=right]:w-full" @close-auto-focus.prevent="returnFocus?.focus()" @escape-key-down="saving && $event.preventDefault()" @pointer-down-outside="saving && $event.preventDefault()">
      <SheetHeader class="border-b px-5 py-4">
        <SheetTitle>{{ editOperation ? 'Изменить операцию' : 'Добавить операцию' }}</SheetTitle>
        <SheetDescription>{{
          editOperation ? 'Изменения пересчитают последующие остатки и себестоимость.' : 'Запись появится в журнале по дате совершения.'
        }}</SheetDescription>
      </SheetHeader>
      <OperationForm
        :key="`${editOperation?.id || 'new'}-${selectedType}`"
        :type="selectedType"
        :operation="editOperation"
        :references="references"
        :saving="saving"
        @cancel="sheetOpen = false"
        @change-type="selectedType = $event"
        @submit="handleSubmit"
      />
    </SheetContent>
  </Sheet>

  <AlertDialog :open="!!pendingDuplicate">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Сохранить возможный дубль?</AlertDialogTitle>
        <AlertDialogDescription>
          Уже есть операция с теми же идентификаторами или реквизитами. Проверь данные. Если это отдельная реальная операция, её можно
          сохранить.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="pendingDuplicate = null">Вернуться к форме</AlertDialogCancel>
        <AlertDialogAction :disabled="saving" @click="saveDuplicate">Сохранить всё равно</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<style scoped>
.fab-enter-active,
.fab-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
}
</style>
