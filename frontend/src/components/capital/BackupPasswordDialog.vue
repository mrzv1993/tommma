<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LockKeyhole } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

const props = defineProps<{
  open: boolean
  mode: 'export' | 'restore'
  busy: boolean
  error?: string
}>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  submit: [password: string]
}>()

const password = ref('')
const confirmation = ref('')
const localError = ref('')
const title = computed(() => (props.mode === 'export' ? 'Зашифровать резервную копию' : 'Открыть резервную копию'))

watch(
  () => props.open,
  (open) => {
    if (!open) {
      password.value = ''
      confirmation.value = ''
      localError.value = ''
    }
  },
)

function setOpen(open: boolean) {
  if (!props.busy) emit('update:open', open)
}

function submit() {
  localError.value = ''
  if (password.value.length < 12) {
    localError.value = 'Используй не менее 12 символов'
    return
  }
  if (props.mode === 'export' && password.value !== confirmation.value) {
    localError.value = 'Пароли не совпадают'
    return
  }
  emit('submit', password.value)
}
</script>

<template>
  <Dialog :open="open" @update:open="setOpen">
    <DialogContent class="sm:max-w-md" :show-close-button="!busy">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2"><LockKeyhole />{{ title }}</DialogTitle>
        <DialogDescription>
          <template v-if="mode === 'export'">
            Пароль не сохраняется и не отправляется на сервер. Без него восстановить этот файл будет невозможно.
          </template>
          <template v-else>Введите пароль, которым была защищена резервная копия.</template>
        </DialogDescription>
      </DialogHeader>

      <form id="backup-password-form" @submit.prevent="submit">
        <FieldGroup>
          <Field :data-invalid="!!(localError || error)">
            <FieldLabel for="backup-password">Пароль резервной копии</FieldLabel>
            <Input
              id="backup-password"
              v-model="password"
              type="password"
              :autocomplete="mode === 'export' ? 'new-password' : 'current-password'"
              :aria-invalid="!!(localError || error)"
              :disabled="busy"
              minlength="12"
              autofocus
            />
            <FieldDescription v-if="mode === 'export'">Минимум 12 символов. Лучше использовать длинную уникальную фразу.</FieldDescription>
          </Field>
          <Field v-if="mode === 'export'" :data-invalid="!!localError">
            <FieldLabel for="backup-password-confirmation">Повторите пароль</FieldLabel>
            <Input
              id="backup-password-confirmation"
              v-model="confirmation"
              type="password"
              autocomplete="new-password"
              :aria-invalid="!!localError"
              :disabled="busy"
              minlength="12"
            />
          </Field>
          <FieldError v-if="localError || error" aria-live="polite">{{ localError || error }}</FieldError>
        </FieldGroup>
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="busy" @click="setOpen(false)">Отмена</Button>
        <Button type="submit" form="backup-password-form" :disabled="busy">
          <Spinner v-if="busy" data-icon="inline-start" />
          {{ mode === 'export' ? 'Создать зашифрованный файл' : 'Расшифровать и восстановить' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
