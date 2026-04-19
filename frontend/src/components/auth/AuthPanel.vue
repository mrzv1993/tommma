<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  mode: 'login' | 'register'
  busy: boolean
  login: string
  password: string
  nickname: string
  email: string
  registerPassword: string
  errorText: string
  successText: string
}>()

const emit = defineEmits<{
  (e: 'update:mode', value: 'login' | 'register'): void
  (e: 'update:login', value: string): void
  (e: 'update:password', value: string): void
  (e: 'update:nickname', value: string): void
  (e: 'update:email', value: string): void
  (e: 'update:registerPassword', value: string): void
  (e: 'submit-login'): void
  (e: 'submit-register'): void
}>()
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Авторизация</CardTitle>
      <CardDescription>Единый аккаунт для локального и удалённого окружения.</CardDescription>
    </CardHeader>

    <CardContent class="flex flex-col gap-4">
      <div class="flex gap-2">
        <Button :variant="props.mode === 'login' ? 'default' : 'outline'" @click="emit('update:mode', 'login')">
          Вход
        </Button>
        <Button
          :variant="props.mode === 'register' ? 'default' : 'outline'"
          @click="emit('update:mode', 'register')"
        >
          Регистрация
        </Button>
      </div>

      <form v-if="props.mode === 'login'" class="flex flex-col gap-3" @submit.prevent="emit('submit-login')">
        <Input
          :model-value="props.login"
          placeholder="Email или ник"
          autocomplete="username"
          required
          @update:model-value="(value) => emit('update:login', String(value ?? ''))"
        />
        <Input
          :model-value="props.password"
          type="password"
          placeholder="Пароль"
          autocomplete="current-password"
          required
          @update:model-value="(value) => emit('update:password', String(value ?? ''))"
        />
        <Button :disabled="props.busy" type="submit">Войти</Button>
      </form>

      <form v-else class="flex flex-col gap-3" @submit.prevent="emit('submit-register')">
        <Input
          :model-value="props.nickname"
          placeholder="Никнейм (латиница/цифры)"
          required
          @update:model-value="(value) => emit('update:nickname', String(value ?? ''))"
        />
        <Input
          :model-value="props.email"
          type="email"
          placeholder="Email"
          autocomplete="email"
          required
          @update:model-value="(value) => emit('update:email', String(value ?? ''))"
        />
        <Input
          :model-value="props.registerPassword"
          type="password"
          placeholder="Пароль"
          autocomplete="new-password"
          required
          @update:model-value="(value) => emit('update:registerPassword', String(value ?? ''))"
        />
        <Button :disabled="props.busy" type="submit">Создать аккаунт</Button>
      </form>

      <p v-if="props.errorText" class="text-sm text-destructive">{{ props.errorText }}</p>
      <p v-if="props.successText" class="text-sm text-primary">{{ props.successText }}</p>
    </CardContent>
  </Card>
</template>
