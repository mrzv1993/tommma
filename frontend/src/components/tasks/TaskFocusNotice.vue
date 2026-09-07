<script setup lang="ts">
import { useTaskFocus } from '@/app/task-focus-context'
const board = useTaskFocus()!
</script>
<template>
  <aside v-if="board.focusMessage.value" class="focus-notice" role="status" aria-live="polite">
    <span>{{ board.focusMessage.value }}</span>
    <button type="button" aria-label="Закрыть уведомление" @click="board.focusMessage.value = ''">×</button>
  </aside>
</template>
<style scoped>
.focus-notice { position:fixed; z-index:110; bottom:24px; right:24px; max-width:min(430px,calc(100vw - 32px)); display:flex; align-items:flex-start; gap:12px; padding:16px; background:#263751; color:white; border-radius:12px; box-shadow:0 4px 24px #18202b33; font-size:14px; }
.focus-notice button { cursor:pointer; color:inherit; background:none; border:0; font-size:20px; }
@media(max-width:480px) { .focus-notice { right:16px; bottom:16px; } }
</style>
