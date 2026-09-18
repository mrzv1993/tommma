import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@capital': fileURLToPath(new URL('../backend/src/capital/shared', import.meta.url)) } },
  test: { testTimeout: 30000, maxWorkers: 2, include: ['src/lib/capital/**/*.test.ts','src/components/capital/**/*.test.ts'], environment: 'jsdom' },
})
