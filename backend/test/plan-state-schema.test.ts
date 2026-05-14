import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStoredPlanElements, planStateSchema, serializePlanState } from '../src/plan-state.ts'

test('plan state schema accepts nested child elements', () => {
  const parsed = planStateSchema.safeParse({
    elements: [
      {
        id: 'root',
        title: 'Root',
        createdAt: 1,
        updatedAt: 1,
        children: [
          {
            id: 'child',
            title: 'Child',
            note: 'Child note',
            completed: true,
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      },
    ],
    deletedElementIds: {},
    baseUpdatedAt: null,
  })

  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.elements[0]?.completed, false)
    assert.equal(parsed.data.elements[0]?.children?.[0]?.title, 'Child')
    assert.equal(parsed.data.elements[0]?.children?.[0]?.note, 'Child note')
    assert.equal(parsed.data.elements[0]?.children?.[0]?.completed, true)
    assert.deepEqual(parsed.data.elements[0]?.children?.[0]?.children, [])
  }
})

test('plan state schema accepts sheets', () => {
  const parsed = planStateSchema.safeParse({
    elements: [],
    deletedElementIds: {},
    activeSheetId: 'sheet-1',
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        elements: [
          {
            id: 'task',
            title: 'Task',
            note: 'Task note',
            completed: true,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        deletedElementIds: {},
        nextStepTaskIds: ['task'],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    baseUpdatedAt: null,
  })

  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.activeSheetId, 'sheet-1')
    assert.equal(parsed.data.sheets[0]?.elements[0]?.completed, true)
    assert.equal(parsed.data.sheets[0]?.elements[0]?.note, 'Task note')
    assert.deepEqual(parsed.data.sheets[0]?.nextStepTaskIds, ['task'])
  }
})

test('serialized plan state restores stored sheets format', () => {
  const stored = buildStoredPlanElements({
    elements: [],
    deletedElementIds: {},
    activeSheetId: 'sheet-1',
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        elements: [],
        deletedElementIds: {},
        nextStepTaskIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  })

  const serialized = serializePlanState({
    elements: stored,
    deletedElementIds: {},
    updatedAt: null,
  })

  assert.equal(serialized.activeSheetId, 'sheet-1')
  assert.equal(serialized.sheets[0]?.title, 'Sheet 1')
  assert.deepEqual(serialized.elements, [])
})
