<script lang="ts">
import { defineComponent } from 'vue'
import AuthPanel from '@/components/auth/AuthPanel.vue'
import CalendarBoard from '@/components/board/CalendarBoard.vue'
import ProjectModals from '@/components/board/ProjectModals.vue'
import ProjectSidebar from '@/components/board/ProjectSidebar.vue'
import AppSidebar from '@/components/navigation/AppSidebar.vue'
import NotesBoard from '@/components/notes/NotesBoard.vue'
import MainSection from '@/components/sections/MainSection.vue'
import PlanSection from '@/components/sections/PlanSection.vue'
import { useAppRoot } from '@/app/AppRoot'

export default defineComponent({
  name: 'App',
  components: {
    AppSidebar,
    AuthPanel,
    CalendarBoard,
    MainSection,
    NotesBoard,
    PlanSection,
    ProjectModals,
    ProjectSidebar,
  },
  setup() {
    return useAppRoot()
  },
})
</script>

<template>
  <main class="screen">
    <AuthPanel
      v-if="!user"
      :mode="mode"
      :busy="busy"
      :login="login"
      :password="password"
      :nickname="nickname"
      :email="email"
      :register-password="registerPassword"
      :error-text="errorText"
      :success-text="successText"
      @update:mode="mode = $event"
      @update:login="login = $event"
      @update:password="password = $event"
      @update:nickname="nickname = $event"
      @update:email="email = $event"
      @update:register-password="registerPassword = $event"
      @submit-login="submitLogin"
      @submit-register="submitRegister"
    />

    <template v-else>
      <AppSidebar
        :active-section="activeSection"
        :sidebar-open="sidebarOpen"
        :collapsed="appNavCollapsed"
        :is-desktop-runtime="isDesktopRuntime"
        :nav-order="navOrder"
        :updater-busy="updaterBusy"
        :user="user"
        :busy="busy"
        @select-section="activeSection = $event"
        @update:sidebar-open="sidebarOpen = $event"
        @update:collapsed="appNavCollapsed = $event"
        @reorder-nav-section="reorderNavSection"
        @update-desktop="handleDesktopUpdate"
        @logout="handleLogout"
      />

      <ProjectSidebar v-if="activeSection === 'board'" />

      <MainSection v-if="activeSection === 'main'" />
      <CalendarBoard v-else-if="activeSection === 'board'" />
      <section v-else-if="activeSection === 'notes'" class="notes-screen" :style="notesInlineStyle">
        <NotesBoard />
      </section>
      <PlanSection v-else-if="activeSection === 'plan'" :username="planUsername" />

      <p v-if="errorText" class="status error">{{ errorText }}</p>
      <p v-if="successText" class="status ok">{{ successText }}</p>
      <p v-if="loading" class="status">Проверка сессии…</p>
      <ProjectModals />
    </template>

    <button
      v-if="isDesktopRuntime"
      class="desktop-export-button"
      type="button"
      :disabled="exportBusy"
      @click="exportDesktopData"
    >
      {{ exportBusy ? 'Экспорт…' : 'Экспорт данных' }}
    </button>
  </main>
</template>

<style src="./app/AppRoot.css"></style>
