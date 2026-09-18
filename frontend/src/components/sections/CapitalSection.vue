<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Download, FileArchive, Filter, LockKeyhole, RefreshCw, Upload } from '@lucide/vue'
import type { NormalizedOperationInput, Operation, OperationFilters, OperationType } from '@capital/contracts'
import { toast } from 'vue-sonner'
import BackupPasswordDialog from '@/components/capital/BackupPasswordDialog.vue'
import FilterBar from '@/components/capital/FilterBar.vue'
import OperationComposer from '@/components/capital/OperationComposer.vue'
import OperationsTable from '@/components/capital/OperationsTable.vue'
import PortfolioSummary from '@/components/capital/PortfolioSummary.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Toaster } from '@/components/ui/sonner'
import { ApiError } from '@/lib/capital/api'
import { decryptBackup, encryptBackup, isEncryptedBackup } from '@/lib/capital/backup-crypto'
import { createLedgerStore } from '@/lib/capital/ledger'

const props = defineProps<{ userId: string }>()
const store = createLedgerStore(props.userId)
const api = store.api
const editOperation = ref<Operation | null>(null)
const archiveCandidate = ref<Operation | null>(null)
const restoreInput = ref<HTMLInputElement | null>(null)
const createType = ref<OperationType | null>(null)
const backupDialogOpen = ref(false)
const backupDialogMode = ref<'export' | 'restore'>('export')
const backupDialogBusy = ref(false)
const backupDialogError = ref('')
const pendingEncryptedBackup = ref<unknown>(null)
let filterTimer: ReturnType<typeof setTimeout> | null = null

const filterModel = computed({
  get: () => ({ ...store.filters }),
  set: (value: OperationFilters) => Object.assign(store.filters, value),
})
const pages = computed(() => Math.max(1, Math.ceil(store.total / (store.filters.pageSize || 20))))
const lastUpdated = computed(() =>
  store.lastSyncAt
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(store.lastSyncAt))
    : 'ещё не запускалась',
)
const syncLabel = computed(() => {
  const progress = store.syncProgress
  const source = store.syncTarget === 'wallet' ? 'кошелёк' : 'биржу'
  if (!store.syncing) return 'Синхронизировать'
  if (!progress) return 'Запускаем синхронизацию…'
  if (progress.phase === 'fetching') return `Получаем ${source}: ${progress.fetched}`
  return `Импортируем ${source}: ${progress.processed} / ${progress.total}`
})
const okxStatusLabel = computed(() =>
  store.okxConnection.configured ? `OKX Exchange: ${store.okxConnection.maskedApiKey}` : 'OKX Exchange не настроен',
)
const okxWalletStatusLabel = computed(() =>
  store.okxWalletConnection.configured ? `OKX Wallet: ${store.okxWalletConnection.maskedAddress}` : 'OKX Wallet не настроен',
)

async function loadApplication() {
  await store.loadReferences()
  void store.loadOkxStatus()
  await Promise.all([store.load(), store.loadBackupState().catch(() => undefined)])
}
onMounted(loadApplication)
onBeforeUnmount(() => { if (filterTimer) clearTimeout(filterTimer); store.dispose() })

function scheduleLoad() {
  if (filterTimer) clearTimeout(filterTimer)
  filterTimer = setTimeout(() => store.load(), 250)
}

async function save(input: NormalizedOperationInput, id?: string, allowDuplicate = false, confirmReview = false): Promise<'saved' | 'duplicate' | 'failed'> {
  try {
    await store.save(input, id, allowDuplicate, confirmReview, editOperation.value?.updatedAt)
    editOperation.value = null
    toast.success(id ? 'Операция обновлена' : 'Операция добавлена')
    return 'saved'
  } catch (error) {
    if (error instanceof ApiError && error.code === 'POSSIBLE_DUPLICATE') return 'duplicate'
    toast.error(error instanceof Error ? error.message : 'Не удалось сохранить операцию')
    return 'failed'
  }
}

async function archive() {
  if (!archiveCandidate.value) return
  try {
    await store.archive(archiveCandidate.value.id)
    toast.success('Операция перемещена в архив')
    archiveCandidate.value = null
  } catch {
    toast.error('Не удалось архивировать операцию')
  }
}

function download(content: BlobPart, filename: string, type: string) {
  if (!store.isActive()) return
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Keep the URL alive until the browser has started reading the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function exportBackup() {
  try {
    download(JSON.stringify(await api.backup(), null, 2), `defi-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
    await store.recordBackupCreated().catch(() => undefined)
    toast.success('Резервная копия создана')
  } catch {
    toast.error('Не удалось создать резервную копию')
  }
}

function openEncryptedBackupExport() {
  backupDialogMode.value = 'export'
  backupDialogError.value = ''
  pendingEncryptedBackup.value = null
  backupDialogOpen.value = true
}

async function restoreBackupData(data: unknown) {
  const result = await api.restore(data)
  await store.load()
  toast.success(
    result.skipped
      ? `Импортировано: ${result.imported}, пропущено дублей: ${result.skipped}`
      : `Импортировано операций: ${result.imported}`,
  )
}

async function submitBackupPassword(password: string) {
  backupDialogBusy.value = true
  backupDialogError.value = ''
  try {
    if (backupDialogMode.value === 'export') {
      const encrypted = await encryptBackup(await api.backup(), password)
      download(JSON.stringify(encrypted, null, 2), `defi-backup-${new Date().toISOString().slice(0, 10)}.defi`, 'application/json')
      await store.recordBackupCreated().catch(() => undefined)
      toast.success('Зашифрованная резервная копия создана')
    } else {
      await restoreBackupData(await decryptBackup(pendingEncryptedBackup.value, password))
    }
    backupDialogOpen.value = false
    pendingEncryptedBackup.value = null
  } catch (error) {
    backupDialogError.value = error instanceof Error ? error.message : 'Не удалось обработать резервную копию'
  } finally {
    backupDialogBusy.value = false
  }
}

async function exportCsv() {
  try {
    const { items: all } = await api.exportOperations({ ...store.filters })
    const header = [
      'id',
      'external_id',
      'date',
      'timezone',
      'type',
      'status',
      'source',
      'out_asset',
      'out_amount',
      'in_asset',
      'in_amount',
      'fee_asset',
      'fee_amount',
      'rub_amount',
      'location_from',
      'location_to',
      'network',
      'tx_hash',
      'destination_address',
      'note',
    ]
    const quote = (value: unknown) => {
      const text = String(value ?? '')
      return `"${(/^[=+@\-\t\r]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`
    }
    const rows = all.map((operation) => {
      const outgoing = operation.legs.find((leg) => leg.direction === 'out')
      const incoming = operation.legs.find((leg) => leg.direction === 'in')
      const fee = operation.legs.find((leg) => leg.direction === 'fee')
      return [
        operation.id,
        operation.externalId,
        operation.occurredAt,
        operation.timezone,
        operation.type,
        operation.status,
        operation.source,
        outgoing?.assetId,
        outgoing?.amount,
        incoming?.assetId,
        incoming?.amount,
        fee?.assetId,
        fee?.amount,
        outgoing?.fiatValue,
        operation.locationFromId,
        operation.locationToId,
        operation.networkId,
        operation.txHash,
        operation.destinationAddress,
        operation.note,
      ]
        .map(quote)
        .join(',')
    })
    download(
      `\uFEFF${header.join(',')}\n${rows.join('\n')}`,
      `operations-${new Date().toISOString().slice(0, 10)}.csv`,
      'text/csv;charset=utf-8',
    )
    toast.success(`Экспортировано операций: ${all.length}`)
  } catch {
    toast.error('Не удалось экспортировать CSV')
  }
}

async function restoreBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text()) as unknown
    if (isEncryptedBackup(data)) {
      pendingEncryptedBackup.value = data
      backupDialogMode.value = 'restore'
      backupDialogError.value = ''
      backupDialogOpen.value = true
    } else {
      await restoreBackupData(data)
    }
  } catch {
    toast.error('Не удалось восстановить резервную копию')
  } finally {
    input.value = ''
  }
}

async function syncOkx() {
  try {
    const result = await store.syncOkx()
    toast.success(`Получено новых записей: ${result.imported}`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Синхронизация не удалась')
  }
}

async function syncOkxWallet() {
  try {
    const result = await store.syncOkxWallet()
    toast.success(`Получено новых записей кошелька: ${result.imported}`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Синхронизация кошелька не удалась')
  }
}

function changePage(page: number) {
  store.filters.page = Math.min(Math.max(1, page), pages.value)
  store.load()
}

function resetAndLoad() {
  store.resetFilters()
  store.load()
}

function changePageSize() {
  store.filters.page = 1
  store.load()
}

function toggleSort() {
  store.filters.sort = store.filters.sort === 'oldest' ? 'newest' : 'oldest'
  store.filters.page = 1
  store.load()
}
</script>

<template>
  <section class="capital-screen" aria-label="Капитал">
      <header class="capital-header flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-6 py-4">
        <div class="flex items-center gap-3">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">Капитал</h1>
            <p class="text-xs text-muted-foreground">Единый журнал движения средств</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button variant="outline" :disabled="store.offline || store.loading" @click="exportCsv"
            ><Download data-icon="inline-start" />{{ store.hasFilters ? 'Экспорт CSV (с фильтрами)' : 'Экспорт CSV' }}</Button
          >
          <DropdownMenu
            ><DropdownMenuTrigger as-child
              ><Button variant="outline" :disabled="store.offline || store.loading"><Filter data-icon="inline-start" />Данные</Button></DropdownMenuTrigger
            ><DropdownMenuContent align="end"
              ><DropdownMenuGroup>
                <DropdownMenuItem disabled><LockKeyhole />{{ okxStatusLabel }}</DropdownMenuItem>
                <DropdownMenuItem disabled><LockKeyhole />{{ okxWalletStatusLabel }}</DropdownMenuItem>
                <DropdownMenuItem @select="exportBackup"><FileArchive />Создать backup JSON</DropdownMenuItem>
                <DropdownMenuItem @select="openEncryptedBackupExport"><LockKeyhole />Создать backup с паролем</DropdownMenuItem>
                <DropdownMenuItem @select="restoreInput?.click()"><Upload />Восстановить backup</DropdownMenuItem>
                <DropdownMenuItem :disabled="store.syncing || !store.okxConnection.configured" @select="syncOkx"
                  ><RefreshCw :class="store.syncing && store.syncTarget === 'exchange' && 'animate-spin'" />Синхронизировать
                  биржу</DropdownMenuItem
                >
                <DropdownMenuItem :disabled="store.syncing || !store.okxWalletConnection.configured" @select="syncOkxWallet"
                  ><RefreshCw :class="store.syncing && store.syncTarget === 'wallet' && 'animate-spin'" />Синхронизировать
                  кошелёк</DropdownMenuItem
                >
              </DropdownMenuGroup></DropdownMenuContent
            ></DropdownMenu
          >
          <input
            ref="restoreInput"
            class="sr-only"
            :disabled="store.offline"
            type="file"
            accept="application/json,.json,.defi"
            aria-label="Файл резервной копии"
            @change="restoreBackup"
          />
        </div>
      </header>

      <div class="capital-content flex flex-col gap-5 p-6">
        <PortfolioSummary :portfolio="store.portfolio" :references="store.references" />
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="source in (['exchange', 'wallet'] as const)" :key="source" class="rounded-xl border bg-white p-3 text-sm">
            <p class="font-medium">{{ source === 'exchange' ? okxStatusLabel : okxWalletStatusLabel }}</p>
            <p class="mt-1 text-xs text-muted-foreground">Последний запуск: {{ store.sourceStates[source]?.startedAt ? new Date(store.sourceStates[source]!.startedAt).toLocaleString('ru-RU') : 'ещё не запускался' }}</p>
            <p class="mt-1 text-xs text-muted-foreground">Последнее успешное обновление: {{ (source === 'exchange' ? store.okxConnection : store.okxWalletConnection).lastSuccessAt ? new Date((source === 'exchange' ? store.okxConnection : store.okxWalletConnection).lastSuccessAt!).toLocaleString('ru-RU') : 'ещё не было' }}</p>
            <Button v-if="store.sourceStates[`${source}Error`]" variant="ghost" size="sm" @click="store.loadOkxStatus">Проверить подключение</Button>
            <p v-if="store.sourceStates[source]" class="mt-1 text-xs">{{ ({ running: 'Синхронизация идёт', completed: 'Синхронизация завершена', failed: 'Ошибка синхронизации', interrupted: 'Синхронизация прервана' } as Record<string,string>)[store.sourceStates[source]!.status] }}</p>
            <p v-if="store.sourceStates[`${source}Error`]" role="alert" class="mt-1 text-red-700">{{ store.sourceStates[`${source}Error`] }}</p>
            <Button class="mt-2" variant="outline" :disabled="store.syncing || store.offline || !(source === 'exchange' ? store.okxConnection.configured : store.okxWalletConnection.configured)" @click="source === 'exchange' ? syncOkx() : syncOkxWallet()">{{ store.syncing && store.syncTarget === source ? syncLabel : 'Синхронизировать' }}</Button>
          </div>
        </div>
        <Alert v-if="store.offline"
          ><RefreshCw /><AlertTitle>Показаны кешированные данные</AlertTitle
          ><AlertDescription
            >Снимок от {{ store.cacheSavedAt ? new Date(store.cacheSavedAt).toLocaleString('ru-RU') : '—' }}. Показана сохранённая страница журнала и сводка всего портфеля. Изменения доступны после восстановления связи. <Button variant="outline" size="sm" @click="store.load(); store.loadOkxStatus()">Проверить соединение</Button></AlertDescription
          ></Alert
        >
        <Alert v-if="store.error" variant="destructive"
          ><AlertTitle>Не удалось загрузить журнал</AlertTitle
          ><AlertDescription class="flex items-center justify-between gap-4"
            ><span>{{ store.error }}</span
            ><Button variant="outline" size="sm" @click="store.load">Повторить</Button></AlertDescription
          ></Alert
        >
        <Alert v-if="store.backupDue">
          <FileArchive />
          <AlertTitle>Пора сохранить резервную копию</AlertTitle>
          <AlertDescription class="flex items-center justify-between gap-4">
            <span>Операции хранятся на сервере, но отдельный зашифрованный файл защитит от потери инфраструктуры.</span>
            <Button variant="outline" size="sm" :disabled="store.offline" @click="openEncryptedBackupExport">Создать с паролем</Button>
          </AlertDescription>
        </Alert>

        <section class="overflow-hidden rounded-xl border bg-background shadow-sm" aria-label="Журнал операций">
          <div class="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 class="font-semibold">Все операции</h2>
              <div class="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Последнее обновление данных: {{ lastUpdated }}</span>
                <span v-if="store.syncing" class="flex items-center gap-1" role="status" aria-live="polite">
                  <Spinner />{{ syncLabel }}
                </span>
                <span v-if="store.recalculating" class="flex items-center gap-1" role="status" aria-live="polite">
                  <Spinner />Пересчитываем кеш…
                </span>
              </div>
            </div>
            <span class="text-sm text-muted-foreground">Записей: {{ store.total }}</span>
          </div>
          <fieldset :disabled="store.offline">
          <FilterBar
            v-model="filterModel"
            :references="store.references"
            :has-filters="store.hasFilters"
            @change="scheduleLoad"
            @reset="resetAndLoad"
          />
          </fieldset>
          <div v-if="store.loading" class="flex flex-col gap-3 p-5" aria-label="Загрузка операций">
            <Skeleton v-for="index in 7" :key="index" class="h-12 w-full" />
          </div>
          <Empty v-else-if="!store.operations.length && !store.error">
            <EmptyHeader
              ><EmptyMedia variant="icon"><FileArchive /></EmptyMedia
              ><EmptyTitle>{{ store.hasFilters ? 'Ничего не найдено' : 'Операций пока нет' }}</EmptyTitle
              ><EmptyDescription>{{
                store.hasFilters ? 'Измени условия поиска или сбрось фильтры.' : 'Добавь первую покупку, конвертацию или перевод.'
              }}</EmptyDescription></EmptyHeader
            >
            <EmptyContent
              ><Button v-if="store.hasFilters" variant="outline" @click="resetAndLoad">Сбросить фильтры</Button
              ><Button v-else :disabled="store.offline" @click="createType = 'purchase'">Добавить первую операцию</Button></EmptyContent
            >
          </Empty>
          <OperationsTable
            v-else
            :operations="store.operations"
            :assets="store.references.assets"
            :locations="store.references.locations"
            :networks="store.references.networks"
            :disabled="store.offline || store.saving"
            :sort="store.filters.sort || 'newest'"
            @edit="editOperation = $event"
            @archive="archiveCandidate = $event"
            @sort="toggleSort"
          />
          <div v-if="store.total && !store.offline" class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">Строк на странице</span
              ><select
                v-model.number="store.filters.pageSize"
                aria-label="Строк на странице"
                class="h-8 rounded-md border bg-background px-2 text-sm"
                @change="changePageSize"
              >
                <option :value="20">20</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </div>
            <div class="flex items-center gap-2" aria-label="Страницы журнала">
              <Button variant="outline" size="sm" :disabled="(store.filters.page || 1) <= 1" @click="changePage((store.filters.page || 1) - 1)">Назад</Button>
              <span class="text-xs">{{ store.filters.page || 1 }} / {{ pages }}</span>
              <Button variant="outline" size="sm" :disabled="(store.filters.page || 1) >= pages" @click="changePage((store.filters.page || 1) + 1)">Далее</Button>
            </div>
          </div>
        </section>
      </div>

    <OperationComposer
      :references="store.references"
      :saving="store.saving"
      :disabled="store.offline || !!store.error"
      :edit-operation="editOperation"
      :open-type="createType"
      :on-save="save"
      @close-edit="editOperation = null"
      @open-handled="createType = null"
    />
    <BackupPasswordDialog
      :open="backupDialogOpen"
      :mode="backupDialogMode"
      :busy="backupDialogBusy"
      :error="backupDialogError"
      @update:open="backupDialogOpen = $event"
      @submit="submitBackupPassword"
    />
    <AlertDialog :open="!!archiveCandidate" @update:open="!$event && !store.saving && (archiveCandidate = null)"
      ><AlertDialogContent
        ><AlertDialogHeader
          ><AlertDialogTitle>Переместить операцию в архив?</AlertDialogTitle
          ><AlertDialogDescription
            >Запись исчезнет из журнала, а последующие остатки и себестоимость будут пересчитаны. История изменения
            сохранится.</AlertDialogDescription
          ></AlertDialogHeader
        ><AlertDialogFooter
          ><AlertDialogCancel :disabled="store.saving">Отмена</AlertDialogCancel><Button :disabled="store.saving" @click="archive">{{ store.saving ? 'Архивируем…' : 'В архив' }}</Button></AlertDialogFooter
        ></AlertDialogContent
      ></AlertDialog
    >
    <Toaster position="top-right" rich-colors />
  </section>
</template>

<style scoped>
.capital-screen { flex: 1; min-width: 0; margin-left: 88px; padding: 16px 16px 80px 0; }
.capital-header { border-radius: 16px 16px 0 0; }
.capital-content { background: #f8fafc; border-radius: 0 0 16px 16px; }
@media(max-width: 700px) { .capital-screen { margin-left: 0; padding: 64px 8px 80px; width: 100%; } .capital-header { padding: 16px; } .capital-content { padding: 12px; } }
</style>
