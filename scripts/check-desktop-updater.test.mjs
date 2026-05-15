import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compareSemver, platformKey, validateManifest } from './check-desktop-updater.mjs'

describe('check-desktop-updater helpers', () => {
  it('maps Tauri updater platform keys', () => {
    assert.equal(platformKey('darwin', 'arm64'), 'darwin-aarch64')
    assert.equal(platformKey('darwin', 'x64'), 'darwin-x86_64')
    assert.equal(platformKey('win32', 'x64'), 'windows-x86_64')
    assert.equal(platformKey('linux', 'arm64'), 'linux-aarch64')
  })

  it('compares semantic versions', () => {
    assert.equal(compareSemver('1.3.4', '1.3.4'), 0)
    assert.equal(compareSemver('1.3.5', '1.3.4'), 1)
    assert.equal(compareSemver('1.3.2', '1.3.4'), -1)
  })

  it('accepts a current manifest with an asset URL and signature', () => {
    const result = validateManifest(
      {
        version: '1.3.4',
        platforms: {
          'darwin-aarch64': {
            signature: 'signature',
            url: 'https://example.com/Tommma.app.tar.gz',
          },
        },
      },
      '1.3.4',
      'darwin-aarch64',
    )

    assert.deepEqual(result, {
      version: '1.3.4',
      url: 'https://example.com/Tommma.app.tar.gz',
    })
  })

  it('rejects a stale published manifest', () => {
    assert.throws(
      () =>
        validateManifest(
          {
            version: '1.3.2',
            platforms: {
              'darwin-aarch64': {
                signature: 'signature',
                url: 'https://example.com/Tommma.app.tar.gz',
              },
            },
          },
          '1.3.4',
          'darwin-aarch64',
        ),
      /older than app version 1\.3\.4/,
    )
  })
})
