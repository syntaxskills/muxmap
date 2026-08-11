import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { addCommandHooks, isMuxMapAgentHookCommand } from '../server/agents.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] === 'status' ? 'status' : 'install'
const available = (command: string) => spawnSync(command, ['--version'], { shell: process.platform === 'win32', stdio: 'ignore' }).status === 0
const hookCommand = (kind: 'codex' | 'claude') => `node "${join(root, 'server/agent-hook.mjs')}" ${kind}`

function readJson(path: string) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : {}
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function installJson(path: string, kind: 'codex' | 'claude', events: string[]) {
  const config = readJson(path)
  const command = hookCommand(kind)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(addCommandHooks(config, events, command, kind), null, 2)}\n`, { mode: 0o600 })
  console.log(`Updated ${kind} hooks in ${path}`)
}

function hookCommandsForEvent(config: Record<string, unknown>, event: string) {
  const hooks = config.hooks && typeof config.hooks === 'object' ? config.hooks as Record<string, unknown> : {}
  const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : []
  return groups.flatMap((group) => Array.isArray(group.hooks)
    ? group.hooks.flatMap((hook) => hook && typeof hook === 'object' ? [(hook as Record<string, unknown>).command] : [])
    : [])
}

function printJsonStatus(path: string, kind: 'codex' | 'claude', events: string[]) {
  if (!available(kind)) {
    console.log(`${kind}: unavailable`)
    return
  }
  const command = hookCommand(kind)
  let config: Record<string, unknown>
  try {
    config = readJson(path)
  } catch (error) {
    console.log(`${kind}: invalid config (${error instanceof Error ? error.message : String(error)})`)
    return
  }
  const missing = events.filter((event) => !hookCommandsForEvent(config, event).includes(command))
  const stale = events.filter((event) => hookCommandsForEvent(config, event).some((candidate) => (
    isMuxMapAgentHookCommand(candidate, kind) && candidate !== command
  )))
  const state = missing.length === 0 && stale.length === 0 ? 'current' : stale.length > 0 ? 'outdated' : 'missing'
  console.log(`${kind}: ${state} (${path})`)
  if (missing.length > 0) console.log(`  missing events: ${missing.join(', ')}`)
  if (stale.length > 0) console.log(`  stale events: ${stale.join(', ')}`)
}

function installPi() {
  const target = join(homedir(), '.pi/agent/extensions/muxmap-status.ts')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(root, 'integrations/pi-status.ts'), target)
  console.log(`Updated Pi extension in ${target}`)
}

function printPiStatus() {
  if (!available('pi')) {
    console.log('pi: unavailable')
    return
  }
  const target = join(homedir(), '.pi/agent/extensions/muxmap-status.ts')
  console.log(`pi: ${existsSync(target) ? 'installed' : 'missing'} (${target})`)
}

if (mode === 'status') {
  printJsonStatus(join(homedir(), '.codex/hooks.json'), 'codex', ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd'])
  printJsonStatus(join(homedir(), '.claude/settings.json'), 'claude', ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'])
  printPiStatus()
} else {
  if (available('codex')) installJson(join(homedir(), '.codex/hooks.json'), 'codex', ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd'])
  else console.log('Skipped codex hooks: codex command unavailable')
  if (available('claude')) installJson(join(homedir(), '.claude/settings.json'), 'claude', ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'])
  else console.log('Skipped claude hooks: claude command unavailable')
  if (available('pi')) installPi()
  else console.log('Skipped Pi extension: pi command unavailable')
  console.log('Run `npm run hooks:status` to verify hook paths.')
}
