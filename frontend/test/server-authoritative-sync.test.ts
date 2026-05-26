import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldUploadLocalCacheWhenServerEmpty } from '../src/app/server-authoritative-sync.ts'

test('does not automatically upload local cache when authenticated server state is empty', () => {
  assert.equal(
    shouldUploadLocalCacheWhenServerEmpty({
      allowExplicitImport: false,
      hasLocalData: true,
      serverStateIsEmpty: true,
    }),
    false,
  )
})

test('allows local cache upload only for an explicit import path', () => {
  assert.equal(
    shouldUploadLocalCacheWhenServerEmpty({
      allowExplicitImport: true,
      hasLocalData: true,
      serverStateIsEmpty: true,
    }),
    true,
  )
})
