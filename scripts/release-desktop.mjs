#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'

const rootDir = resolve(new URL('..', import.meta.url).pathname)
const frontendDir = join(rootDir, 'frontend')
const tauriDir = join(frontendDir, 'src-tauri')
const rootPackagePath = join(rootDir, 'package.json')
const syncVersionScript = join(rootDir, 'scripts', 'sync-version.mjs')
const bundleDir = join(tauriDir, 'target', 'release', 'bundle')
const repo = process.env.GITHUB_REPOSITORY || 'mrzv1993/tommma'
const signingKeyPath =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || join(homedir(), '.tauri', 'tommma-updater.key')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: readFileSync(signingKeyPath, 'utf8'),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '',
    },
    stdio: 'inherit',
    ...options,
  })

  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

function read(command, args) {
  return execFileSync(command, args, { cwd: rootDir, encoding: 'utf8' }).trim()
}

function collectFiles(dir, predicate, result = []) {
  if (!existsSync(dir)) return result

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(path, predicate, result)
      continue
    }

    if (predicate(path)) {
      result.push(path)
    }
  }

  return result
}

function latestFile(files) {
  return files.sort((a, b) => a.localeCompare(b)).at(-1)
}

function platformKey() {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64'
  }

  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'windows-aarch64' : 'windows-x86_64'
  }

  return process.arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64'
}

function bundleArch() {
  return process.arch === 'arm64' ? 'aarch64' : process.arch
}

if (!existsSync(signingKeyPath)) {
  console.error(`Signing key not found: ${signingKeyPath}`)
  console.error('Set TAURI_SIGNING_PRIVATE_KEY_PATH or create the key before releasing.')
  process.exit(1)
}

run(process.execPath, [syncVersionScript])

const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'))
const version = rootPackage.version
const fullSha = read('git', ['rev-parse', 'HEAD'])
const shortSha = read('git', ['rev-parse', '--short=7', 'HEAD'])
const tag = process.env.DESKTOP_RELEASE_TAG || `desktop-v${version}-main-${shortSha}`
const gitStatus = read('git', ['status', '--porcelain'])

if (gitStatus && process.env.DESKTOP_RELEASE_DRY_RUN !== '1' && process.env.DESKTOP_RELEASE_ALLOW_DIRTY !== '1') {
  console.error('The working tree has uncommitted changes. Commit and push main before publishing a desktop release.')
  console.error('Set DESKTOP_RELEASE_ALLOW_DIRTY=1 only if you intentionally want to release the current local files.')
  process.exit(1)
}

console.log(`Building signed desktop release ${tag}...`)
run('pnpm', ['-C', frontendDir, 'exec', 'tauri', 'build', '--bundles', 'app'])

const updaterArchive = latestFile(collectFiles(bundleDir, (file) => file.endsWith('.app.tar.gz')))
const updaterSignature = updaterArchive ? `${updaterArchive}.sig` : ''
let installer

if (process.platform === 'darwin') {
  const appBundle = join(bundleDir, 'macos', 'Tommma.app')
  const dmgDir = join(bundleDir, 'dmg')
  installer = join(dmgDir, `Tommma_${version}_${bundleArch()}.dmg`)
  mkdirSync(dmgDir, { recursive: true })
  run('hdiutil', ['create', '-volname', 'Tommma', '-srcfolder', appBundle, '-ov', '-format', 'UDZO', installer])
} else {
  installer = latestFile(
    collectFiles(
      bundleDir,
      (file) =>
        (file.endsWith('.msi') || file.endsWith('.AppImage')) &&
        !basename(file).startsWith('rw.'),
    ),
  )
}

if (!updaterArchive || !existsSync(updaterSignature) || !installer) {
  console.error('Could not find all desktop release artifacts.')
  console.error(`Installer: ${installer || 'missing'}`)
  console.error(`Updater archive: ${updaterArchive || 'missing'}`)
  console.error(`Updater signature: ${updaterSignature || 'missing'}`)
  process.exit(1)
}

mkdirSync(bundleDir, { recursive: true })
const latestJsonPath = join(bundleDir, 'latest.json')
const updaterArchiveName = basename(updaterArchive)
const latestJson = {
  version,
  notes: `Desktop build from main ${shortSha}.`,
  pub_date: new Date().toISOString(),
  platforms: {
    [platformKey()]: {
      signature: readFileSync(updaterSignature, 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${updaterArchiveName}`,
    },
  },
}

writeFileSync(latestJsonPath, `${JSON.stringify(latestJson, null, 2)}\n`)

console.log(`Publishing GitHub release ${tag}...`)
if (process.env.DESKTOP_RELEASE_DRY_RUN === '1') {
  console.log('DESKTOP_RELEASE_DRY_RUN=1, skipping GitHub release creation.')
} else {
  run('gh', [
    'release',
    'create',
    tag,
    installer,
    updaterArchive,
    updaterSignature,
    latestJsonPath,
    '--repo',
    repo,
    '--target',
    fullSha,
    '--title',
    `Desktop ${version} (${shortSha})`,
    '--notes',
    `Desktop release ${version} from main ${shortSha}.`,
    '--latest',
  ])
}

console.log('')
console.log(`DMG: https://github.com/${repo}/releases/download/${tag}/${basename(installer)}`)
console.log(`Updater manifest: https://github.com/${repo}/releases/latest/download/latest.json`)
