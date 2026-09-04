<script setup lang="ts">
import authHeroUrl from '@/assets/auth-productivity-hero.jpg'
import { Button } from '@/components/ui/button'
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
  <section class="auth-page" aria-labelledby="auth-title">
    <div class="auth-shell">
      <aside class="auth-visual" aria-label="Рабочее пространство Tommma">
        <img
          class="auth-visual-image"
          :src="authHeroUrl"
          alt="Деревянный стул на цветущем холме под облачным небом"
        />
      </aside>

      <div class="auth-form-side">
        <div class="auth-form-wrap">
          <header class="auth-heading">
            <h1 id="auth-title">
              {{ props.mode === 'login' ? 'С возвращением' : 'Создай аккаунт' }}
            </h1>
          </header>

          <form
            v-if="props.mode === 'login'"
            class="auth-form"
            @submit.prevent="emit('submit-login')"
          >
            <label class="auth-field">
              <span>Email или ник</span>
              <Input
                :model-value="props.login"
                class="auth-input"
                placeholder="name@example.com"
                autocomplete="username"
                required
                @update:model-value="(value) => emit('update:login', String(value ?? ''))"
              />
            </label>

            <label class="auth-field">
              <span>Пароль</span>
              <Input
                :model-value="props.password"
                class="auth-input"
                type="password"
                placeholder="Введите пароль"
                autocomplete="current-password"
                required
                @update:model-value="(value) => emit('update:password', String(value ?? ''))"
              />
            </label>

            <Button class="auth-submit" :disabled="props.busy" type="submit">
              {{ props.busy ? 'Входим…' : 'Войти' }}
            </Button>
          </form>

          <form v-else class="auth-form" @submit.prevent="emit('submit-register')">
            <label class="auth-field">
              <span>Никнейм</span>
              <Input
                :model-value="props.nickname"
                class="auth-input"
                placeholder="Латиница и цифры"
                autocomplete="nickname"
                required
                @update:model-value="(value) => emit('update:nickname', String(value ?? ''))"
              />
            </label>

            <label class="auth-field">
              <span>Email</span>
              <Input
                :model-value="props.email"
                class="auth-input"
                type="email"
                placeholder="name@example.com"
                autocomplete="email"
                required
                @update:model-value="(value) => emit('update:email', String(value ?? ''))"
              />
            </label>

            <label class="auth-field">
              <span>Пароль</span>
              <Input
                :model-value="props.registerPassword"
                class="auth-input"
                type="password"
                placeholder="Придумайте пароль"
                autocomplete="new-password"
                required
                @update:model-value="(value) => emit('update:registerPassword', String(value ?? ''))"
              />
            </label>

            <Button class="auth-submit" :disabled="props.busy" type="submit">
              {{ props.busy ? 'Создаём…' : 'Создать аккаунт' }}
            </Button>
          </form>

          <div class="auth-status" aria-live="polite">
            <p v-if="props.errorText" class="auth-message error">{{ props.errorText }}</p>
            <p v-if="props.successText" class="auth-message success">{{ props.successText }}</p>
          </div>

          <p class="auth-switch-hint">
            {{ props.mode === 'login' ? 'Впервые в Tommma?' : 'Уже есть аккаунт?' }}
            <button
              type="button"
              @click="emit('update:mode', props.mode === 'login' ? 'register' : 'login')"
            >
              {{ props.mode === 'login' ? 'Зарегистрироваться' : 'Войти' }}
            </button>
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.auth-page {
  flex: 1;
  min-width: 0;
  min-height: 100vh;
  padding: 0;
  display: grid;
  place-items: center;
  background: #e8e8eb;
  color: #1b1b1f;
}

.auth-shell {
  width: 100%;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(440px, 0.92fr);
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 80%);
  border-radius: 0;
  background: #ffffff;
  box-shadow: 0 24px 70px rgb(31 35 48 / 10%);
}

.auth-visual {
  position: relative;
  min-height: 680px;
  margin: 18px;
  overflow: hidden;
  border-radius: 24px;
  background: #f2f0eb;
}

.auth-visual-image {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center 44%;
}

.auth-form-side {
  display: grid;
  place-items: center;
  padding: clamp(44px, 6vw, 92px);
}

.auth-form-wrap {
  width: min(430px, 100%);
}

.auth-switch-hint button:focus-visible {
  outline: 3px solid rgb(98 93 168 / 24%);
  outline-offset: 2px;
}

.auth-heading {
  margin-bottom: 34px;
}

.auth-heading h1 {
  margin: 0;
  font-size: clamp(34px, 4vw, 48px);
  line-height: 1.04;
  font-weight: 690;
  letter-spacing: -0.052em;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #303036;
  font-size: 13px;
  font-weight: 650;
}

.auth-input {
  height: 52px;
  border-color: #dedee3;
  border-radius: 13px;
  background: #ffffff;
  padding-inline: 16px;
  color: #202024;
  font-size: 15px;
  box-shadow: 0 1px 2px rgb(20 22 30 / 3%);
}

.auth-input::placeholder {
  color: #a4a4aa;
}

.auth-input:focus-visible {
  border-color: #736cc0;
  box-shadow: 0 0 0 4px rgb(115 108 192 / 13%);
}

.auth-submit {
  height: 52px;
  margin-top: 6px;
  border-radius: 13px;
  background: #1d1d21;
  color: #ffffff;
  font-size: 14px;
  font-weight: 680;
  box-shadow: 0 12px 28px rgb(29 29 33 / 14%);
}

.auth-submit:hover {
  background: #343438;
}

.auth-submit:focus-visible {
  box-shadow: 0 0 0 4px rgb(98 93 168 / 20%);
}

.auth-status {
  min-height: 20px;
  margin-top: 16px;
}

.auth-message {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.45;
}

.auth-message.error {
  background: #fff1f1;
  color: #a22929;
}

.auth-message.success {
  background: #eef9f0;
  color: #28733a;
}

.auth-switch-hint {
  margin: 14px 0 0;
  color: #88888f;
  font-size: 13px;
  text-align: center;
}

.auth-switch-hint button {
  padding: 3px 4px;
  border: 0;
  background: transparent;
  color: #27272c;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.auth-switch-hint button:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 980px) {
  .auth-shell {
    grid-template-columns: minmax(0, 0.86fr) minmax(400px, 1fr);
  }

  .auth-form-side {
    padding: 44px;
  }

}

@media (max-width: 760px) {
  .auth-page {
    align-items: start;
    padding: 0;
  }

  .auth-shell {
    min-height: 100vh;
    grid-template-columns: 1fr;
    border-radius: 0;
  }

  .auth-visual {
    min-height: 250px;
    max-height: 32vh;
    margin: 10px;
    border-radius: 18px;
  }

  .auth-form-side {
    padding: 34px 24px 42px;
  }

  .auth-heading {
    margin-bottom: 28px;
  }

  .auth-heading h1 {
    font-size: 36px;
  }
}

@media (max-width: 420px) {
  .auth-visual {
    min-height: 210px;
  }

  .auth-form-side {
    padding-inline: 20px;
  }

  .auth-input,
  .auth-submit {
    height: 50px;
  }
}

</style>
