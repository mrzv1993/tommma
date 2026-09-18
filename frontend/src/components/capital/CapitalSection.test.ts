import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CapitalSection from '@/components/sections/CapitalSection.vue'

const mock = vi.hoisted(() => ({ archive: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/capital/ledger', () => ({ createLedgerStore: () => ({
  api: {}, operations: [{ id: 'own-operation' }], references: { assets: [], locations: [], networks: [] }, portfolio: { positions: [], investedRub: '0', feesRub: '0' },
  filters: { page: 1, pageSize: 20 }, total: 1, hasFilters: false, loading: false, saving: false, syncing: false, offline: false, error: null,
  sourceStates: {}, okxConnection: { configured: false }, okxWalletConnection: { configured: false },
  loadReferences: vi.fn(), loadOkxStatus: vi.fn(), load: vi.fn(), loadBackupState: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), archive: mock.archive,
}) }))
vi.mock('vue-sonner', () => ({ Toaster: { template: '<div />' }, toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks() })
it('keeps the selected operation until the archive request is submitted through the actual dialog', async () => {
  const wrapper = mount(CapitalSection, { attachTo: document.body, props: { userId: '1' }, global: { stubs: {
    PortfolioSummary: true, FilterBar: true, OperationComposer: true, BackupPasswordDialog: true, Toaster: true,
    OperationsTable: { emits: ['archive'], template: '<button @click="$emit(\'archive\', {id: \'own-operation\'})">Test archive</button>' },
  } } })
  await wrapper.findAll('button').find(button => button.text() === 'Test archive')!.trigger('click')
  await flushPromises()
  const confirm = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'В архив')!
  expect(confirm).toBeTruthy()
  confirm.click(); await flushPromises()
  expect(mock.archive).toHaveBeenCalledExactlyOnceWith('own-operation')
  expect(document.body.textContent).not.toContain('Переместить операцию в архив?')
  wrapper.unmount()
})
