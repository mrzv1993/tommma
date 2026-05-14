<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiRequestError, api, type PlanState, type PlanStateElement } from '@/lib/api'

const props = defineProps<{
  username: string
}>()

type PlanElement = PlanStateElement

const PLAN_ITEM_LEFT_PADDING = 16
const PLAN_ITEM_RIGHT_PADDING = 48
const PLAN_ITEM_MAX_WIDTH = 320
const PLAN_ITEM_MIN_WIDTH = 80
const PLAN_ITEM_FONT = '600 13px "Inter Variable", "Inter", system-ui, sans-serif'

const rootChildren = ref<PlanElement[]>([])
const deletedElementIds = ref<Record<string, number>>({})
const namingElementId = ref('')
const creatingElement = ref(false)
const nameDraft = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

let measureCanvas: HTMLCanvasElement | null = null
let planStateHydrating = false
let planSyncDirty = false
let planSyncInFlight = false
let planSyncPendingAfterFlight = false
let planSyncRetryTimeout: number | null = null
let planSyncInterval: number | null = null
let planServerUpdatedAt: string | null = null

const planItemWidth = computed(() => {
  const measuredWidths = rootChildren.value
    .filter((element) => element.title.trim())
    .map((element) =>
      Math.min(
        PLAN_ITEM_MAX_WIDTH,
        Math.ceil(measureTextWidth(element.title) + PLAN_ITEM_LEFT_PADDING + PLAN_ITEM_RIGHT_PADDING),
      ),
    )

  if (!measuredWidths.length) return PLAN_ITEM_MIN_WIDTH
  return Math.max(PLAN_ITEM_MIN_WIDTH, ...measuredWidths)
})

function deletePlanElement(elementId: string) {
  deletedElementIds.value = {
    ...deletedElementIds.value,
    [elementId]: Date.now(),
  }
  rootChildren.value = rootChildren.value.filter((element) => element.id !== elementId)
  if (namingElementId.value === elementId) {
    closeNameModal()
  }
  markPlanStateDirty()
}

function planElementHeight() {
  const slots = Math.max(rootChildren.value.length, 2)
  return `${100 / slots}%`
}

function openCreateModal() {
  creatingElement.value = true
  namingElementId.value = ''
  nameDraft.value = ''
  focusNameInput()
}

function focusNameInput() {
  void nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function closeNameModal() {
  namingElementId.value = ''
  creatingElement.value = false
  nameDraft.value = ''
}

function submitNameModal() {
  const title = nameDraft.value.trim()
  if (!title) return
  if (creatingElement.value) {
    const now = Date.now()
    rootChildren.value.push({
      id: crypto.randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
    })
    markPlanStateDirty()
    closeNameModal()
    return
  }

  const element = rootChildren.value.find((item) => item.id === namingElementId.value)
  if (element) {
    element.title = title
    element.updatedAt = Date.now()
    markPlanStateDirty()
  }
  closeNameModal()
}

function measureTextWidth(text: string) {
  if (typeof document === 'undefined') return text.length * 8
  measureCanvas ||= document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) return text.length * 8
  context.font = PLAN_ITEM_FONT
  return context.measureText(text).width
}

function normalizeDeletedElementIds(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, number>>((acc, [id, value]) => {
    if (!id) return acc
    const timestamp = Number(value)
    if (Number.isFinite(timestamp) && timestamp >= 0) {
      acc[id] = timestamp
    }
    return acc
  }, {})
}

function normalizePlanElements(raw: unknown): PlanElement[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Partial<PlanElement>
      if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') return null
      const createdAt = Number(candidate.createdAt || Date.now())
      const updatedAt = Number(candidate.updatedAt || createdAt)
      if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return null
      return {
        id: candidate.id,
        title: candidate.title,
        createdAt,
        updatedAt,
      }
    })
    .filter((item): item is PlanElement => Boolean(item))
    .sort((a, b) => a.createdAt - b.createdAt)
}

function buildPlanStatePayload(): PlanState {
  return {
    elements: rootChildren.value.map((element) => ({ ...element })),
    deletedElementIds: { ...deletedElementIds.value },
    baseUpdatedAt: planServerUpdatedAt,
  }
}

function isPlanStateEffectivelyEmpty(state: PlanState) {
  return state.elements.length === 0 && Object.keys(state.deletedElementIds || {}).length === 0
}

function hasLocalPlanData() {
  return rootChildren.value.length > 0 || Object.keys(deletedElementIds.value).length > 0
}

function mergeDeletedElementIds(
  serverDeleted: Record<string, number>,
  localDeleted: Record<string, number>,
) {
  const merged = { ...serverDeleted }
  for (const [id, deletedAt] of Object.entries(localDeleted)) {
    if (!merged[id] || deletedAt > merged[id]) {
      merged[id] = deletedAt
    }
  }
  return merged
}

function mergePlanStates(server: PlanState, local: PlanState): PlanState {
  const serverDeleted = normalizeDeletedElementIds(server.deletedElementIds || {})
  const localDeleted = normalizeDeletedElementIds(local.deletedElementIds || {})
  const deletedElementIds = mergeDeletedElementIds(serverDeleted, localDeleted)
  const elementsById = new Map<string, PlanElement>()

  for (const element of normalizePlanElements(server.elements)) {
    elementsById.set(element.id, element)
  }
  for (const element of normalizePlanElements(local.elements)) {
    const existing = elementsById.get(element.id)
    if (!existing || element.updatedAt >= existing.updatedAt) {
      elementsById.set(element.id, element)
    }
  }

  const elements = [...elementsById.values()]
    .filter((element) => {
      const deletedAt = deletedElementIds[element.id]
      return !deletedAt || deletedAt < element.updatedAt
    })
    .sort((a, b) => a.createdAt - b.createdAt)

  return {
    elements,
    deletedElementIds,
    updatedAt: server.updatedAt ?? null,
    baseUpdatedAt: server.updatedAt ?? null,
  }
}

function applyPlanState(state: PlanState) {
  planStateHydrating = true
  try {
    const nextDeletedElementIds = normalizeDeletedElementIds(state.deletedElementIds || {})
    deletedElementIds.value = nextDeletedElementIds
    rootChildren.value = normalizePlanElements(state.elements).filter((element) => {
      const deletedAt = nextDeletedElementIds[element.id]
      return !deletedAt || deletedAt < element.updatedAt
    })
    planServerUpdatedAt = state.updatedAt ?? null
  } finally {
    planStateHydrating = false
  }
}

function schedulePlanStateSync(delayMs = 0) {
  if (planSyncRetryTimeout) {
    window.clearTimeout(planSyncRetryTimeout)
  }
  planSyncRetryTimeout = window.setTimeout(() => {
    planSyncRetryTimeout = null
    void syncPlanState()
  }, delayMs)
}

function markPlanStateDirty() {
  if (planStateHydrating) return
  planSyncDirty = true
  schedulePlanStateSync(250)
}

async function syncPlanState() {
  if (planStateHydrating) return
  if (planSyncInFlight) {
    planSyncPendingAfterFlight = true
    return
  }

  planSyncInFlight = true
  try {
    if (planSyncDirty) {
      const localPayload = buildPlanStatePayload()
      let result: Awaited<ReturnType<typeof api.putPlanState>>
      try {
        result = await api.putPlanState(localPayload)
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 409) {
          const current = (error.payload as { planState?: PlanState } | undefined)?.planState
          if (current) {
            const merged = mergePlanStates(current, localPayload)
            applyPlanState(merged)
            planSyncDirty = true
            schedulePlanStateSync(0)
            return
          }
        }
        throw error
      }
      applyPlanState(result.planState)
      planSyncDirty = false
    } else {
      const result = await api.getPlanState()
      if (isPlanStateEffectivelyEmpty(result.planState) && hasLocalPlanData()) {
        planSyncDirty = true
        schedulePlanStateSync(0)
        return
      }
      applyPlanState(result.planState)
    }
  } catch {
    schedulePlanStateSync(planSyncDirty ? 2000 : 5000)
  } finally {
    planSyncInFlight = false
    if (planSyncPendingAfterFlight) {
      planSyncPendingAfterFlight = false
      schedulePlanStateSync(0)
    }
  }
}

async function loadPlanStateFromServer() {
  try {
    const result = await api.getPlanState()
    applyPlanState(result.planState)
  } catch {
    schedulePlanStateSync(5000)
  }
}

function syncPlanOnForeground() {
  if (document.visibilityState === 'hidden') return
  void syncPlanState()
}

onMounted(async () => {
  await loadPlanStateFromServer()
  window.addEventListener('focus', syncPlanOnForeground)
  document.addEventListener('visibilitychange', syncPlanOnForeground)
  planSyncInterval = window.setInterval(() => {
    void syncPlanState()
  }, 10_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', syncPlanOnForeground)
  document.removeEventListener('visibilitychange', syncPlanOnForeground)
  if (planSyncRetryTimeout) {
    window.clearTimeout(planSyncRetryTimeout)
    planSyncRetryTimeout = null
  }
  if (planSyncInterval) {
    window.clearInterval(planSyncInterval)
    planSyncInterval = null
  }
})
</script>

<template>
  <section class="plan-section" aria-label="План">
    <aside class="plan-user-rail">
      <span class="plan-user-name">{{ props.username }}</span>
    </aside>
    <button
      v-if="!rootChildren.length"
      class="plan-add-right"
      type="button"
      aria-label="Добавить элемент"
      title="Добавить элемент"
      @click="openCreateModal"
    />
    <div v-else class="plan-children-column" :style="{ width: `${planItemWidth}px` }">
      <article
        v-for="element in rootChildren"
        :key="element.id"
        class="plan-child-card"
        :style="{ height: planElementHeight(), width: `${planItemWidth}px` }"
      >
        <span class="plan-child-title">{{ element.title }}</span>
        <button
          class="plan-child-delete"
          type="button"
          aria-label="Удалить элемент"
          title="Удалить"
          @click.stop="deletePlanElement(element.id)"
        >
          <Trash2 class="plan-child-delete-icon" />
        </button>
      </article>
    </div>
    <button
      v-if="rootChildren.length"
      class="plan-add-more"
      type="button"
      @click="openCreateModal"
    >
      Добавить ещё один элемент
    </button>

    <div v-if="creatingElement || namingElementId" class="plan-modal-backdrop" @click.self="closeNameModal">
      <form class="plan-modal" @submit.prevent="submitNameModal">
        <input
          ref="nameInputRef"
          v-model="nameDraft"
          class="plan-name-input"
          type="text"
          aria-label="Название элемента"
          @keydown.esc.prevent="closeNameModal"
        />
      </form>
    </div>
  </section>
</template>

<style scoped>
.plan-section {
  margin-left: 88px;
  flex: 1;
  min-height: 100vh;
  display: flex;
  align-items: stretch;
  background: #f3f4f6;
  position: relative;
}

.plan-user-rail {
  width: 80px;
  height: 100vh;
  border-radius: 16px;
  border: 1px solid #B9B9B9;
  border: 1px solid color(display-p3 0.7241 0.7241 0.7241);
  background: #F5F6FD;
  background: color(display-p3 0.9608 0.9647 0.9882);
  box-shadow: 0 0 40px 0 #ABABAB inset;
  box-shadow: 0 0 40px 0 color(display-p3 0.6725 0.6725 0.6725) inset;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.plan-user-name {
  color: #242a31;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
  padding: 8px;
}

.plan-add-right {
  position: absolute;
  left: 76px;
  top: 8px;
  width: 9px;
  height: calc(100vh - 16px);
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #6f7890;
  padding: 0;
  cursor: pointer;
  z-index: 1;
}

.plan-add-more:hover,
.plan-child-delete:hover {
  background: rgba(255, 255, 255, 0.45);
}

.plan-add-right:hover {
  background: #B5A5FF;
}

.plan-children-column {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.plan-child-card {
  border-radius: 16px;
  border: 1px solid #B9B9B9;
  border: 1px solid color(display-p3 0.7241 0.7241 0.7241);
  background: #F5F6FD;
  background: color(display-p3 0.9608 0.9647 0.9882);
  box-shadow: 0 0 40px 0 #ABABAB inset;
  box-shadow: 0 0 40px 0 color(display-p3 0.6725 0.6725 0.6725) inset;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.plan-child-title {
  width: 100%;
  padding: 0 48px 0 16px;
  color: #242a31;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
  white-space: normal;
}

.plan-add-more {
  min-width: 0;
  border: 1px dashed rgba(111, 120, 144, 0.35);
  background: transparent;
  color: #6f7890;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
}

.plan-add-more {
  width: 80px;
  height: 100vh;
  padding: 0 10px;
}

.plan-child-delete {
  position: absolute;
  right: 4px;
  bottom: 8px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #8a4b5f;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.plan-child-delete-icon {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}

.plan-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(35, 41, 49, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
}

.plan-modal {
  width: min(360px, calc(100vw - 40px));
  border-radius: 12px;
  background: #ffffff;
  padding: 14px;
  box-shadow: 0 20px 60px rgba(36, 42, 49, 0.18);
}

.plan-name-input {
  width: 100%;
  height: 42px;
  border: 1px solid #c8cfda;
  border-radius: 8px;
  background: #f9fbff;
  color: #242a31;
  font: inherit;
  outline: none;
  padding: 0 12px;
}

.plan-name-input:focus {
  border-color: #8ea6d8;
  box-shadow: 0 0 0 3px rgba(142, 166, 216, 0.22);
}

@media (max-width: 980px) {
  .plan-section {
    margin-left: 0;
  }
}
</style>
