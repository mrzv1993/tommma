<script setup lang="ts">
import {
  Box,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  RefreshCw,
  X,
} from '@lucide/vue'

import type { AppSection } from '@/app/navigation'
import sidebarIcon1 from '@/assets/sidebar-icon-1.png'
import sidebarIcon2 from '@/assets/sidebar-icon-2.png'

defineProps<{
  activeSection: AppSection
  sidebarOpen: boolean
  collapsed: boolean
  isDesktopRuntime: boolean
  updaterBusy: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  'update:sidebarOpen': [value: boolean]
  'update:collapsed': [value: boolean]
  selectSection: [section: AppSection]
  updateDesktop: []
  logout: []
}>()

function selectSection(section: AppSection) {
  emit('selectSection', section)
  emit('update:sidebarOpen', false)
}
</script>

<template>
  <button class="mobile-nav-toggle" @click="emit('update:sidebarOpen', !sidebarOpen)">
    <Menu v-if="!sidebarOpen" :size="18" />
    <X v-else :size="18" />
  </button>
  <aside class="app-sidebar" :class="{ open: sidebarOpen, collapsed }">
    <button
      class="section-icon"
      :class="{ active: activeSection === 'board' }"
      title="Текущий раздел"
      @click="selectSection('board')"
    >
      <img class="section-icon-img" :src="sidebarIcon1" alt="" />
    </button>
    <button
      class="section-icon"
      :class="{ active: activeSection === 'notes' }"
      title="Заметки"
      @click="selectSection('notes')"
    >
      <img class="section-icon-img" :src="sidebarIcon2" alt="" />
    </button>
    <button
      class="section-icon"
      :class="{ active: activeSection === 'plan' }"
      title="План"
      aria-label="План"
      @click="selectSection('plan')"
    >
      <Box class="section-icon-svg" />
    </button>
    <div class="app-sidebar-spacer" />
    <button
      v-if="isDesktopRuntime"
      class="sidebar-update"
      :disabled="updaterBusy"
      aria-label="Обновить"
      title="Обновить"
      @click="emit('updateDesktop')"
    >
      <RefreshCw class="sidebar-action-icon" :class="{ spinning: updaterBusy }" />
    </button>
    <button class="sidebar-logout" :disabled="busy" aria-label="Выйти" title="Выйти" @click="emit('logout')">
      <LogOut class="sidebar-action-icon" />
    </button>
  </aside>
  <button
    class="app-sidebar-toggle"
    :class="{ collapsed }"
    type="button"
    :aria-label="collapsed ? 'Раскрыть навигацию' : 'Скрыть навигацию'"
    :title="collapsed ? 'Раскрыть навигацию' : 'Скрыть навигацию'"
    @click="emit('update:collapsed', !collapsed)"
  >
    <ChevronRight v-if="collapsed" :size="16" />
    <ChevronLeft v-else :size="16" />
  </button>
</template>

<style scoped>
.mobile-nav-toggle {
  display: none;
  position: fixed;
  left: 16px;
  top: 16px;
  z-index: 50;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: #e5ebf5;
  color: #334155;
}

.app-sidebar {
  position: fixed;
  left: 16px;
  top: 16px;
  z-index: 40;
  width: 56px;
  border-radius: 16px;
  padding: 8px;
  background: #e8edf6;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.2s ease;
}

.app-sidebar-spacer {
  flex: 1;
}

.app-sidebar.collapsed {
  transform: translateX(-88px);
}

.app-sidebar-toggle {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 41;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  background: #e8edf6;
  color: #4b5c72;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: left 0.2s ease;
}

.app-sidebar-toggle.collapsed {
  left: 8px;
}

.section-icon {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 10px;
  background: #f8fbff;
  color: #4b5c72;
  padding: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.section-icon.active {
  background: #d6e4fb;
  color: #1f3b67;
}

.section-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  display: block;
}

.section-icon-svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.9;
}

.sidebar-update,
.sidebar-logout {
  border: 0;
  border-radius: 8px;
  background: #eff1f5;
  color: #404954;
  cursor: pointer;
  min-width: 40px;
  min-height: 40px;
  font-size: 26px;
  line-height: 1;
  padding: 0;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sidebar-update:hover,
.sidebar-logout:hover {
  background: #dae2ec;
}

.sidebar-update:disabled,
.sidebar-logout:disabled {
  cursor: default;
  opacity: 0.55;
}

.sidebar-action-icon {
  width: 20px;
  height: 20px;
}

.sidebar-action-icon.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 980px) {
  .mobile-nav-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .app-sidebar {
    transform: translateX(-140%);
    transition: transform 0.2s ease;
  }

  .app-sidebar.open {
    transform: translateX(0);
  }

  .app-sidebar-toggle {
    display: none;
  }
}
</style>
