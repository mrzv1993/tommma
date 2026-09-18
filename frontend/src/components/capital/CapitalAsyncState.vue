<script setup lang="ts">
defineProps<{ error?: Error }>()
const reload = () => window.location.reload()
</script>

<template>
  <div class="p-6 text-sm" :role="error ? 'alert' : 'status'">
    <template v-if="error">
      <p>Не удалось открыть «Капитал». Проверь соединение и повтори загрузку.</p>
      <button class="mt-3 rounded-lg border px-4 py-2 focus-visible:outline-2" @click="reload">Повторить загрузку</button>
    </template>
    <p v-else>Загружаем «Капитал»…</p>
  </div>
</template>
