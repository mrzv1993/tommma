import assert from 'node:assert/strict'
import test from 'node:test'

import { serializeUserPreferences } from '../src/user-preferences.ts'

test('user preferences normalizes nav order from stored json', () => {
  const serialized = serializeUserPreferences({
    navOrder: ['plan', 'unknown', 'main', 'plan'],
    updatedAt: null,
  })

  assert.deepEqual(serialized.navOrder, ['plan', 'main', 'board', 'notes'])
  assert.equal(serialized.updatedAt, null)
})
