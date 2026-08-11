import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultFs = { existsSync, readdirSync, readFileSync, statSync }
const fallbackCodexEvents = new Set(['SessionStart'])

function parseEvent(input) {
  try { return input ? JSON.parse(input) : {} } catch { return {} }
}

function stringField(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

function hookEventName(event) {
  return stringField(event, ['hook_event_name', 'hookEventName', 'event', 'type'])
    ?? stringField(event?.payload, ['hook_event_name', 'hookEventName', 'event', 'type'])
}

function walkJsonlFiles(directory, files = [], fs = defaultFs) {
  let entries = []
  try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return files }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    try {
      if (entry.isDirectory()) walkJsonlFiles(path, files, fs)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
    } catch {
      // Codex can rotate session files while hooks are running. Ignore races.
    }
  }
  return files
}

function sessionMetaFromFile(path, fs = defaultFs) {
  try {
    const first = fs.readFileSync(path, 'utf8').split(/\r?\n/, 1)[0]
    const parsed = JSON.parse(first)
    const payload = parsed?.payload
    if (parsed?.type !== 'session_meta' || !payload) return
    return {
      session_id: stringField(payload, ['session_id', 'id']),
      session_path: path,
      cwd: stringField(payload, ['cwd']),
    }
  } catch {
    return
  }
}

function safeMtime(file, fs = defaultFs) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return
  }
}

export function fallbackCodexSession({ cwd = process.cwd(), env = process.env, now = Date.now(), fs = defaultFs } = {}) {
  const codexRoot = env.CODEX_HOME || join(homedir(), '.codex')
  const sessionRoot = join(codexRoot, 'sessions')
  try {
    if (!fs.existsSync(sessionRoot)) return {}
  } catch {
    return {}
  }
  const cutoff = now - 24 * 60 * 60 * 1000
  for (const path of walkJsonlFiles(sessionRoot, [], fs)
    .map((file) => ({ file, mtime: safeMtime(file, fs) }))
    .filter((item) => typeof item.mtime === 'number')
    .filter((item) => item.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 80)
    .map((item) => item.file)) {
    const meta = sessionMetaFromFile(path, fs)
    if (meta?.session_id && meta.cwd === cwd) return meta
  }
  return {}
}

export function codexSessionInfo(event, { cwd = process.cwd(), env = process.env, now = Date.now(), fs = defaultFs } = {}) {
  const direct = {
    session_id: stringField(event, ['session_id', 'sessionId', 'conversation_id']) ?? stringField(event?.payload, ['session_id', 'sessionId', 'id']),
    session_path: stringField(event, ['session_path', 'sessionPath']),
    cwd: stringField(event, ['cwd']) ?? cwd,
  }
  if (direct.session_id) return direct
  if (!fallbackCodexEvents.has(hookEventName(event))) return { cwd: direct.cwd }
  return { ...fallbackCodexSession({ cwd: direct.cwd, env, now, fs }), cwd: direct.cwd }
}

async function readStdin() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input
}

export async function main() {
  try {
    const input = await readStdin()
    const event = parseEvent(input)
    const tmuxPane = process.env.TMUX_PANE
    const zellijSession = process.env.ZELLIJ_SESSION_NAME
    const kind = process.argv[2]
    const locator = tmuxPane
      ? { backend: 'tmux', paneId: tmuxPane }
      : zellijSession ? { backend: 'zellij', runtimeName: zellijSession, paneId: process.env.ZELLIJ_PANE_ID } : undefined
    if (!locator || !['codex', 'claude'].includes(kind)) return

    const headers = { 'content-type': 'application/json', 'x-muxmap-hook': '1' }
    if (process.env.MUXMAP_TOKEN) headers.authorization = `Basic ${Buffer.from(`muxmap:${process.env.MUXMAP_TOKEN}`).toString('base64')}`
    await fetch(`${process.env.MUXMAP_URL ?? 'http://127.0.0.1:4782'}/api/agent-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, locator, event: kind === 'codex' ? { ...event, muxmap: codexSessionInfo(event) } : event }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Agent work must never depend on the optional MuxMap observer.
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main().catch(() => {})
}
