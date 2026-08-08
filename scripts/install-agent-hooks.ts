import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { addCommandHooks } from '../server/agents.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const available = (command: string) => spawnSync(command, ['--version'], { shell: process.platform === 'win32', stdio: 'ignore' }).status === 0

function installJson(path: string, kind: 'codex' | 'claude', events: string[]) {
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : {}
  const command = `node "${join(root, 'server/agent-hook.mjs')}" ${kind}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(addCommandHooks(config, events, command), null, 2)}\n`, { mode: 0o600 })
  console.log(`Installed ${kind} hooks in ${path}`)
}

if (available('codex')) installJson(join(homedir(), '.codex/hooks.json'), 'codex', ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd'])
if (available('claude')) installJson(join(homedir(), '.claude/settings.json'), 'claude', ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'])
if (available('pi')) {
  const target = join(homedir(), '.pi/agent/extensions/muxmap-status.ts')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(root, 'integrations/pi-status.ts'), target)
  console.log(`Installed Pi extension in ${target}`)
}
