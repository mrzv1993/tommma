import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import OperationForm from './OperationForm.vue'
import { defaultReferences } from '@capital/references'
import type { Operation } from '@capital/contracts'
const operation: Operation = {
 id: 'test', type: 'purchase', status: 'needs_review', source: 'okx_exchange', occurredAt: '2026-09-01T10:02:34.567Z', timezone: 'Asia/Bangkok', locationFromId: 'fiat', locationToId: 'okx', externalId: 'ext', logIndex: 5, createdAt: '2026-09-01T10:02:34.567Z', updatedAt: '2026-09-01T10:02:34.567Z',
 legs: [{ id: '1', direction: 'out', assetId: 'rub', amount: '8000', fiatValue: '8000', unitPrice: '80', locationId: 'fiat', position: 0 }, { id: '2', direction: 'in', assetId: 'usdt', amount: '100', locationId: 'okx', position: 1 }],
}
describe('financial operation editing', () => {
 it('preserves review status, seconds, timezone, external metadata and prices on a note edit', async () => {
  const wrapper = mount(OperationForm, { props: { type: 'purchase', operation, references: defaultReferences, saving: false } })
  await wrapper.get('#note').setValue('Later')
  await wrapper.get('form').trigger('submit')
  const [payload, confirmed] = wrapper.emitted('submit')![0] as [Operation,boolean]
  expect(payload).toMatchObject({ status: 'needs_review', occurredAt: operation.occurredAt, timezone: operation.timezone, logIndex: 5, note: 'Later' })
  expect(payload.legs[0]).toMatchObject({ fiatValue: '8000', unitPrice: '80' })
  expect(confirmed).toBe(false)
  wrapper.unmount()
 })
 it('requires a distinct confirmation action and blocks duplicate submission while saving', async () => {
  const wrapper = mount(OperationForm, { props: { type: 'purchase', operation, references: defaultReferences, saving: false } })
  await wrapper.get('input[type=checkbox]').setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')![0]).toMatchObject([{ status: 'completed' },true])
  await wrapper.setProps({ saving: true }); await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('submit')).toHaveLength(1)
  wrapper.unmount()
 })
})
