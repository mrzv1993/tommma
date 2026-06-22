#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const skipMacDistributionChecks = process.env.DESKTOP_RELEASE_SKIP_MACOS_DISTRIBUTION_CHECKS === '1'

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

function fail(message, details = []) {
  console.error(message)
  for (const detail of details) {
    console.error(detail)
  }
  process.exit(1)
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

function macSigningIdentity() {
  return process.env.TAURI_MACOS_SIGNING_IDENTITY || process.env.APPLE_SIGNING_IDENTITY || ''
}

function hasMacNotarizationCredentials() {
  const hasAppleIdCredentials =
    Boolean(process.env.APPLE_ID) &&
    Boolean(process.env.APPLE_PASSWORD) &&
    (Boolean(process.env.APPLE_TEAM_ID) || Boolean(process.env.APPLE_PROVIDER_SHORT_NAME))
  const hasApiKeyCredentials =
    Boolean(process.env.APPLE_API_ISSUER) &&
    (Boolean(process.env.APPLE_API_KEY) || Boolean(process.env.APPLE_API_KEY_PATH))

  return hasAppleIdCredentials || hasApiKeyCredentials
}

function requireMacDistributionSetup() {
  if (process.platform !== 'darwin' || skipMacDistributionChecks) {
    return macSigningIdentity()
  }

  const identity = macSigningIdentity()
  if (!identity || !identity.includes('Developer ID Application')) {
    fail('macOS desktop releases require a Developer ID Application signing identity.', [
      'Set TAURI_MACOS_SIGNING_IDENTITY="Developer ID Application: ..." before running release:desktop.',
      'Apple Development/ad-hoc signatures are rejected by Gatekeeper for downloaded public apps.',
    ])
  }

  const identities = read('security', ['find-identity', '-v', '-p', 'codesigning'])
  if (!identities.includes(identity)) {
    fail(`Configured macOS signing identity was not found in the current keychain: ${identity}`)
  }

  if (!hasMacNotarizationCredentials()) {
    fail('macOS desktop releases require Apple notarization credentials.', [
      'Set either APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID,',
      'or APPLE_API_ISSUER + APPLE_API_KEY/APPLE_API_KEY_PATH before publishing.',
    ])
  }

  return identity
}

function tauriBuildArgs(identity) {
  const args = ['-C', frontendDir, 'exec', 'tauri', 'build']
  args.push('--bundles', process.platform === 'darwin' ? 'app,dmg' : 'app')

  if (process.platform === 'darwin' && identity) {
    const macOS = { signingIdentity: identity }
    if (process.env.APPLE_PROVIDER_SHORT_NAME) {
      macOS.providerShortName = process.env.APPLE_PROVIDER_SHORT_NAME
    }
    args.push('--config', JSON.stringify({ bundle: { macOS } }))
  }

  return args
}

function verifyMacDistribution(appBundle) {
  if (process.platform !== 'darwin' || skipMacDistributionChecks) return

  run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appBundle])
  run('spctl', ['-a', '-vvv', '-t', 'execute', appBundle])
}

if (!existsSync(signingKeyPath)) {
  fail(`Signing key not found: ${signingKeyPath}`, [
    'Set TAURI_SIGNING_PRIVATE_KEY_PATH or create the key before releasing.',
  ])
}

run(process.execPath, [syncVersionScript])
const signingIdentity = requireMacDistributionSetup()

const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'))
const version = rootPackage.version
const fullSha = read('git', ['rev-parse', 'HEAD'])
const shortSha = read('git', ['rev-parse', '--short=7', 'HEAD'])
const tag = process.env.DESKTOP_RELEASE_TAG || `desktop-v${version}-main-${shortSha}`
const gitStatus = read('git', ['status', '--porcelain'])

if (gitStatus && process.env.DESKTOP_RELEASE_DRY_RUN !== '1' && process.env.DESKTOP_RELEASE_ALLOW_DIRTY !== '1') {
  fail('The working tree has uncommitted changes. Commit and push main before publishing a desktop release.', [
    'Set DESKTOP_RELEASE_ALLOW_DIRTY=1 only if you intentionally want to release the current local files.',
  ])
}

console.log(`Building signed desktop release ${tag}...`)
rmSync(bundleDir, { recursive: true, force: true })
run('pnpm', tauriBuildArgs(signingIdentity))

const updaterArchive = latestFile(collectFiles(bundleDir, (file) => file.endsWith('.app.tar.gz')))
const updaterSignature = updaterArchive ? `${updaterArchive}.sig` : ''
let installer

if (process.platform === 'darwin') {
  const appBundle = join(bundleDir, 'macos', 'Tommma.app')
  verifyMacDistribution(appBundle)
  installer = latestFile(
    collectFiles(
      bundleDir,
      (file) =>
        file.endsWith(`_${bundleArch()}.dmg`) &&
        !basename(file).startsWith('rw.') &&
        basename(file).includes(version),
    ),
  )
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
