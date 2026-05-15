#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDir = resolve(new URL('..', import.meta.url).pathname)
const rootPackagePath = resolve(rootDir, 'package.json')
const defaultManifestUrl = 'https://github.com/mrzv1993/tommma/releases/latest/download/latest.json'

export function platformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64'
  }

  if (platform === 'win32') {
    return arch === 'arm64' ? 'windows-aarch64' : 'windows-x86_64'
  }

  return arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64'
}

export function compareSemver(left, right) {
  const leftParts = parseSemver(left)
  const rightParts = parseSemver(right)

  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index]
    if (diff !== 0) return Math.sign(diff)
  }

  return 0
}

export function validateManifest(manifest, currentVersion, targetPlatform) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Desktop updater manifest is not an object.')
  }

  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('Desktop updater manifest does not include a version.')
  }

  if (compareSemver(manifest.version, currentVersion) < 0) {
    throw new Error(
      `Published desktop updater version ${manifest.version} is older than app version ${currentVersion}. Run npm run release:desktop after the branch is merged and pushed.`,
    )
  }

  const platform = manifest.platforms?.[targetPlatform]
  if (!platform || typeof platform !== 'object') {
    throw new Error(`Desktop updater manifest does not include platform ${targetPlatform}.`)
  }

  if (typeof platform.url !== 'string' || !platform.url.trim()) {
    throw new Error(`Desktop updater manifest platform ${targetPlatform} does not include an asset URL.`)
  }

  if (typeof platform.signature !== 'string' || !platform.signature.trim()) {
    throw new Error(`Desktop updater manifest platform ${targetPlatform} does not include a signature.`)
  }

  return {
    version: manifest.version,
    url: platform.url,
  }
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value).trim())
  if (!match) {
    throw new Error(`Invalid semantic version: ${value}`)
  }

  return match.slice(1).map(Number)
}

async function main() {
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'))
  const currentVersion = rootPackage.version
  const manifestUrl = process.env.DESKTOP_UPDATER_MANIFEST_URL || defaultManifestUrl
  const targetPlatform = process.env.DESKTOP_UPDATER_PLATFORM || platformKey()

  const manifestResponse = await fetch(manifestUrl, { cache: 'no-store' })
  if (!manifestResponse.ok) {
    throw new Error(`Failed to fetch desktop updater manifest: ${manifestResponse.status} ${manifestResponse.statusText}`)
  }

  const manifest = await manifestResponse.json()
  const result = validateManifest(manifest, currentVersion, targetPlatform)

  const assetResponse = await fetch(result.url, { method: 'HEAD', redirect: 'follow' })
  if (!assetResponse.ok) {
    throw new Error(`Failed to access desktop updater asset: ${assetResponse.status} ${assetResponse.statusText}`)
  }

  console.log(`Desktop updater manifest OK: ${result.version} for ${targetPlatform}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
