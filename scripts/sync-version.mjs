#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rootDir = resolve(new URL('..', import.meta.url).pathname)
const rootPackagePath = resolve(rootDir, 'package.json')
const rootLockPath = resolve(rootDir, 'package-lock.json')
const frontendPackagePath = resolve(rootDir, 'frontend', 'package.json')
const tauriConfigPath = resolve(rootDir, 'frontend', 'src-tauri', 'tauri.conf.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJsonIfChanged(path, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`
  if (!existsSync(path) || readFileSync(path, 'utf8') !== next) {
    writeFileSync(path, next)
    return true
  }
  return false
}

const rootPackage = readJson(rootPackagePath)
const version = rootPackage.version

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid root package version: ${version}`)
  process.exit(1)
}

const frontendPackage = readJson(frontendPackagePath)
frontendPackage.version = version

const tauriConfig = readJson(tauriConfigPath)
tauriConfig.version = version

const changed = [
  writeJsonIfChanged(frontendPackagePath, frontendPackage),
  writeJsonIfChanged(tauriConfigPath, tauriConfig),
]

if (existsSync(rootLockPath)) {
  const rootLock = readJson(rootLockPath)
  rootLock.version = version
  if (rootLock.packages?.['']) {
    rootLock.packages[''].version = version
  }
  changed.push(writeJsonIfChanged(rootLockPath, rootLock))
}

console.log(`Synced app version ${version}${changed.some(Boolean) ? '' : ' (already current)'}`)
