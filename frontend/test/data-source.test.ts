import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeApiDataSource,
  scopedAuthTokenStorageKey,
  scopedClientCacheOwner,
} from '../src/lib/data-source.ts'

test('defaults unknown and missing data sources to production', () => {
  assert.equal(normalizeApiDataSource(undefined), 'production')
  assert.equal(normalizeApiDataSource('production'), 'production')
  assert.equal(normalizeApiDataSource('unexpected'), 'production')
  assert.equal(normalizeApiDataSource('local'), 'local')
})

test('separates auth tokens and client caches between production and local data', () => {
  assert.notEqual(
    scopedAuthTokenStorageKey('production'),
    scopedAuthTokenStorageKey('local'),
  )
  assert.notEqual(
    scopedClientCacheOwner('production', '42'),
    scopedClientCacheOwner('local', '42'),
  )
})
