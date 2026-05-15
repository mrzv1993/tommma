<script setup lang="ts">
import {
  Box,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  House,
  LogOut,
  Menu,
  RefreshCw,
  SquareStack,
  User,
  X,
} from '@lucide/vue'
import { computed, ref } from 'vue'

import type { AppSection } from '@/app/navigation'
import type { SessionUser } from '@/lib/api'

const props = defineProps<{
  activeSection: AppSection
  sidebarOpen: boolean
  collapsed: boolean
  isDesktopRuntime: boolean
  navOrder: AppSection[]
  updaterBusy: boolean
  user: SessionUser | null
  busy: boolean
}>()

const emit = defineEmits<{
  'update:sidebarOpen': [value: boolean]
  'update:collapsed': [value: boolean]
  reorderNavSection: [draggedSection: AppSection, targetSection: AppSection]
  selectSection: [section: AppSection]
  updateDesktop: []
  logout: []
}>()

const profileOpen = ref(false)
const draggingSection = ref<AppSection | ''>('')

const navMeta: Record<AppSection, { title: string; ariaLabel: string }> = {
  main: { title: 'Главный', ariaLabel: 'Главный раздел' },
  board: { title: 'Календарь', ariaLabel: 'Календарь' },
  notes: { title: 'Карточки', ariaLabel: 'Карточки' },
  plan: { title: 'План', ariaLabel: 'План' },
}

const orderedSections = computed(() =>
  props.navOrder.filter((section, index, list) => section in navMeta && list.indexOf(section) === index),
)

const profileInitials = computed(() => {
  const source = props.user?.nickname || props.user?.email || ''
  const parts = source.trim().split(/[\s._-]+/).filter(Boolean)
  if (!parts.length) return 'U'
  return parts
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('')
})

function selectSection(section: AppSection) {
  emit('selectSection', section)
  emit('update:sidebarOpen', false)
}

function startNavDrag(event: DragEvent, section: AppSection) {
  draggingSection.value = section
  event.dataTransfer?.setData('application/x-tommma-nav-section', section)
  event.dataTransfer?.setData('text/plain', section)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

function allowNavDrop(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function dropNavSection(event: DragEvent, targetSection: AppSection) {
  event.preventDefault()
  const dragged =
    (event.dataTransfer?.getData('application/x-tommma-nav-section') ||
      event.dataTransfer?.getData('text/plain') ||
      draggingSection.value) as AppSection
  draggingSection.value = ''
  if (!dragged || dragged === targetSection) return
  emit('reorderNavSection', dragged, targetSection)
}

function closeProfileOnBlur(event: FocusEvent) {
  const currentTarget = event.currentTarget as HTMLElement | null
  const nextTarget = event.relatedTarget as Node | null
  if (currentTarget && nextTarget && currentTarget.contains(nextTarget)) return
  profileOpen.value = false
}
</script>

<template>
  <button class="mobile-nav-toggle" @click="emit('update:sidebarOpen', !sidebarOpen)">
    <Menu v-if="!sidebarOpen" :size="18" />
    <X v-else :size="18" />
  </button>
  <aside class="app-sidebar" :class="{ open: sidebarOpen, collapsed }">
    <button
      v-for="section in orderedSections"
      :key="section"
      class="section-icon"
      :class="{ active: activeSection === section, dragging: draggingSection === section }"
      :title="navMeta[section].title"
      :aria-label="navMeta[section].ariaLabel"
      draggable="true"
      @click="selectSection(section)"
      @dragstart="startNavDrag($event, section)"
      @dragend="draggingSection = ''"
      @dragover="allowNavDrop"
      @drop="dropNavSection($event, section)"
    >
      <House v-if="section === 'main'" class="section-icon-svg" />
      <CalendarDays v-else-if="section === 'board'" class="section-icon-svg" />
      <SquareStack v-else-if="section === 'notes'" class="section-icon-svg" />
      <Box v-else class="section-icon-svg" />
      <GripVertical class="section-drag-handle" aria-hidden="true" />
    </button>
    <div class="app-sidebar-spacer" />
    <div class="sidebar-profile-wrap" tabindex="-1" @focusout="closeProfileOnBlur">
      <button
        class="sidebar-profile"
        type="button"
        :aria-expanded="profileOpen"
        aria-label="Профиль"
        title="Профиль"
        @click="profileOpen = !profileOpen"
      >
        <span v-if="user" class="sidebar-avatar">{{ profileInitials }}</span>
        <User v-else class="sidebar-action-icon" />
      </button>
      <div v-if="profileOpen" class="sidebar-profile-popover">
        <div class="sidebar-profile-meta">
          <span class="sidebar-profile-name">{{ user?.nickname || 'Профиль' }}</span>
          <span class="sidebar-profile-email">{{ user?.email || '' }}</span>
        </div>
        <button class="sidebar-profile-action" :disabled="busy" type="button" @click="emit('logout')">
          <LogOut class="sidebar-profile-action-icon" />
          <span>Выйти</span>
        </button>
      </div>
    </div>
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
  position: relative;
}

.section-icon.active {
  background: #d6e4fb;
  color: #1f3b67;
}

.section-icon.dragging {
  opacity: 0.45;
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

.section-drag-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 10px;
  height: 10px;
  color: #8fa0b5;
  opacity: 0;
  pointer-events: none;
}

.section-icon:hover .section-drag-handle {
  opacity: 1;
}

.sidebar-profile-wrap {
  position: relative;
}

.sidebar-profile {
  border: 0;
  border-radius: 999px;
  background: #f8fbff;
  color: #404954;
  cursor: pointer;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.sidebar-avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: #d6e4fb;
  color: #1f3b67;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
}

.sidebar-profile-popover {
  position: absolute;
  left: 48px;
  bottom: 0;
  z-index: 60;
  width: 220px;
  border: 1px solid #dfe5ef;
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(17, 24, 39, 0.18);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-profile-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
}

.sidebar-profile-name,
.sidebar-profile-email {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-profile-name {
  color: #242a31;
  font-size: 13px;
  font-weight: 750;
}

.sidebar-profile-email {
  color: #687489;
  font-size: 11px;
  font-weight: 500;
}

.sidebar-profile-action {
  border: 0;
  border-radius: 8px;
  background: #f3f5f9;
  color: #394454;
  cursor: pointer;
  min-height: 34px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
}

.sidebar-profile-action:hover {
  background: #e6ebf3;
}

.sidebar-profile-action:disabled {
  cursor: default;
  opacity: 0.55;
}

.sidebar-profile-action-icon {
  width: 16px;
  height: 16px;
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
