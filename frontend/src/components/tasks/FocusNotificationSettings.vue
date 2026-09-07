<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Bell } from '@lucide/vue'
import { disableWebNotifications, enableWebNotifications, showWebNotification, webNotificationState } from '@/lib/web-focus-notifications'

const state = ref(webNotificationState())
const busy = ref(false)
const message = ref('')
function refresh() { state.value = webNotificationState() }
onMounted(() => { window.addEventListener('focus', refresh); window.addEventListener('storage', refresh) })
onBeforeUnmount(() => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh) })
async function enable() {
  busy.value = true
  message.value = ''
  try {
    state.value = await enableWebNotifications()
    if (state.value === 'off') message.value = 'Разрешение не получено. Нажми «Включить» и разреши уведомления.'
  } catch { message.value = 'Не удалось включить уведомления. Попробуй ещё раз.' }
  finally { busy.value = false }
}
function disable() { disableWebNotifications(); refresh(); message.value = '' }
async function test() {
  busy.value = true
  const result = await showWebNotification({ title: 'Tommma · Проверка уведомлений', body: 'Так ты узнаешь, что сердце закончилось. Следующая жизнь ждёт нажатия Play.', tag: 'tommma-focus-test' })
  refresh()
  message.value = result === 'shown'
    ? 'Отправлено. Если баннера нет, проверь уведомления браузера и режим «Не беспокоить» в системе.'
    : 'Не удалось показать уведомление. Проверь разрешения браузера и попробуй снова.'
  busy.value = false
}
</script>
<template>
  <section class="notification-settings" aria-label="Уведомления таймера" :aria-busy="busy">
    <strong><Bell :size="15" aria-hidden="true" />Уведомления таймера</strong>
    <p>После каждого сердца, пока Tommma открыт и таймер работает.</p>
    <p v-if="state === 'unsupported'">В этом браузере системные уведомления недоступны. Сообщение о завершении останется внутри Tommma.</p>
    <p v-else-if="state === 'denied'">Уведомления заблокированы. Разреши их в настройках сайта в браузере, затем нажми «Включить».</p>
    <template v-else>
      <span class="notification-state">{{ state === 'on' ? 'Включены в этом браузере' : 'Выключены' }}</span>
      <div class="notification-actions">
        <template v-if="state === 'on'">
          <button type="button" :disabled="busy" @click="test">{{ busy ? 'Отправка…' : 'Проверить' }}</button>
          <button type="button" :disabled="busy" @click="disable">Выключить</button>
        </template>
        <button v-else type="button" :disabled="busy" @click="enable">{{ busy ? 'Включение…' : 'Включить' }}</button>
      </div>
    </template>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.notification-settings { padding:12px 6px; border-top:1px solid #dfe5ef; border-bottom:1px solid #dfe5ef; display:flex; flex-direction:column; gap:8px; color:#394454; }
strong { display:flex; align-items:center; gap:6px; font-size:13px; }
p { margin:0; font-size:12px; line-height:1.45; color:#687489; }
.notification-state { font-size:12px; }
.notification-actions { display:flex; gap:6px; flex-wrap:wrap; }
button { padding:7px 10px; border:1px solid #dfe5ef; border-radius:6px; background:#f3f5f9; color:#394454; font-size:12px; cursor:pointer; }
button:hover { background:#e6ebf3; } button:disabled { opacity:.55; cursor:default; }
button:focus-visible { outline:2px solid #5369bc; outline-offset:2px; }
</style>
