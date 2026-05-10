#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const repoRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const defaultPorts = [8787, 5173, 5174]

function parseArgs(argv) {
  const result = {
    yes: false,
    ports: defaultPorts,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') {
      result.yes = true
      continue
    }
    if (arg === '--ports') {
      const raw = argv[i + 1] || ''
      i += 1
      result.ports = raw
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
      continue
    }
  }

  if (!result.ports.length) result.ports = defaultPorts
  return result
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

function getListeners(port) {
  const output = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pc'])
  const listeners = []
  let current = null

  for (const line of output.split('\n')) {
    if (!line) continue
    const type = line[0]
    const value = line.slice(1)
    if (type === 'p') {
      if (current) listeners.push(current)
      current = { pid: Number(value), commandName: '' }
    } else if (type === 'c' && current) {
      current.commandName = value
    }
  }
  if (current) listeners.push(current)

  return listeners.filter((listener) => Number.isInteger(listener.pid))
}

function getProcessInfo(pid) {
  const output = run('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'command=']).trim()
  if (!output) return null
  const [ppidRaw, ...commandParts] = output.split(/\s+/)
  const ppid = Number(ppidRaw)
  const command = commandParts.join(' ')
  return {
    pid,
    ppid: Number.isInteger(ppid) ? ppid : 0,
    command,
    cwd: getCwd(pid),
  }
}

function getCwd(pid) {
  const output = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
  const line = output.split('\n').find((entry) => entry.startsWith('n'))
  if (!line) return ''
  try {
    return realpathSync(line.slice(1))
  } catch {
    return line.slice(1)
  }
}

function isInsideRepo(path) {
  return path === repoRoot || path.startsWith(`${repoRoot}${sep}`)
}

function isDevToolCommand(command) {
  return /(^|\s)(node|npm|pnpm|npx|tsx)(\s|$)/.test(command) ||
    /\/node(\s|$)/.test(command) ||
    /node_modules\/tsx\//.test(command) ||
    /node_modules\/\.bin\/(concurrently|vite|tsx)/.test(command) ||
    /\/pnpm\s+-C\s+frontend\s+dev/.test(command) ||
    /npm\s+--prefix\s+backend\s+run\s+dev/.test(command)
}

function findProjectDevRoot(pid) {
  let currentPid = pid
  let candidate = null
  const seen = new Set()

  while (currentPid > 1 && !seen.has(currentPid)) {
    seen.add(currentPid)
    const info = getProcessInfo(currentPid)
    if (!info) break
    if (isInsideRepo(info.cwd) && isDevToolCommand(info.command)) {
      candidate = info
      currentPid = info.ppid
      continue
    }
    break
  }

  return candidate
}

function collectConflicts(ports) {
  const conflicts = []

  for (const port of ports) {
    for (const listener of getListeners(port)) {
      if (listener.pid === process.pid) continue
      const listenerInfo = getProcessInfo(listener.pid)
      if (!listenerInfo || !isInsideRepo(listenerInfo.cwd)) continue
      const killTarget = findProjectDevRoot(listener.pid)
      if (!killTarget) continue
      conflicts.push({
        port,
        listener: listenerInfo,
        killTarget,
      })
    }
  }

  const unique = new Map()
  for (const conflict of conflicts) {
    const key = `${conflict.port}:${conflict.listener.pid}:${conflict.killTarget.pid}`
    unique.set(key, conflict)
  }
  return [...unique.values()]
}

function formatCommand(command) {
  if (command.length <= 110) return command
  return `${command.slice(0, 107)}...`
}

function printConflicts(conflicts) {
  console.log('\nНайдены уже запущенные процессы Tommma на dev-портах:\n')
  for (const conflict of conflicts) {
    console.log(`  :${conflict.port} слушает PID ${conflict.listener.pid}`)
    console.log(`    ${formatCommand(conflict.listener.command)}`)
    if (conflict.killTarget.pid !== conflict.listener.pid) {
      console.log(`    остановить dev-процесс PID ${conflict.killTarget.pid}: ${formatCommand(conflict.killTarget.command)}`)
    }
  }
  console.log('')
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function stopProcesses(pids) {
  const uniquePids = [...new Set(pids)].filter((pid) => pid > 1 && pid !== process.pid && pid !== process.ppid)
  for (const pid of uniquePids) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Process may have exited between detection and kill.
    }
  }

  const deadline = Date.now() + 4000
  while (Date.now() < deadline && uniquePids.some(isAlive)) {
    await sleep(150)
  }

  for (const pid of uniquePids) {
    if (!isAlive(pid)) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Nothing else to do if the process is already gone or cannot be killed.
    }
  }
}

async function confirmStop() {
  if (!input.isTTY) return false
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question('Остановить эти процессы и продолжить запуск? [y/N] ')
    return ['y', 'yes', 'д', 'да'].includes(answer.trim().toLowerCase())
  } finally {
    rl.close()
  }
}

async function main() {
  if (process.env.TOMMMA_DEV_PORT_GUARD === '0') return

  const options = parseArgs(process.argv.slice(2))
  const conflicts = collectConflicts(options.ports)
  if (!conflicts.length) return

  printConflicts(conflicts)

  const shouldStop = options.yes || await confirmStop()
  if (!shouldStop) {
    console.error('Запуск остановлен. Завершите старые процессы или запустите npm run dev:clean.')
    process.exit(1)
  }

  await stopProcesses(conflicts.map((conflict) => conflict.killTarget.pid))

  const remaining = collectConflicts(options.ports)
  if (remaining.length) {
    printConflicts(remaining)
    console.error('Не удалось освободить все dev-порты.')
    process.exit(1)
  }

  console.log('Dev-порты освобождены, продолжаю запуск.\n')
}

await main()
