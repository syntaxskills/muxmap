import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let input = ''
for await (const chunk of process.stdin) input += chunk
const tmuxPane = process.env.TMUX_PANE
const zellijSession = process.env.ZELLIJ_SESSION_NAME
const kind = process.argv[2]
const locator = tmuxPane
  ? { backend: 'tmux', paneId: tmuxPane }
  : zellijSession ? { backend: 'zellij', runtimeName: zellijSession, paneId: process.env.ZELLIJ_PANE_ID } : undefined

function parseEvent() {
  try { return input ? JSON.parse(input) : {} } catch { return {} }
}

const event = parseEvent()

function stringField(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

function walkJsonlFiles(directory, files = []) {
  let entries = []
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return files }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walkJsonlFiles(path, files)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
  }
  return files
}

function sessionMetaFromFile(path) {
  try {
    const first = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0]
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

function fallbackCodexSession() {
  const codexRoot = process.env.CODEX_HOME || join(homedir(), '.codex')
  const sessionRoot = join(codexRoot, 'sessions')
  if (!existsSync(sessionRoot)) return {}
  const cwd = process.cwd()
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const path of walkJsonlFiles(sessionRoot)
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .filter((item) => item.mtime >= cutoff)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 80)
    .map((item) => item.file)) {
    const meta = sessionMetaFromFile(path)
    if (meta?.session_id && meta.cwd === cwd) return meta
  }
  return {}
}

function codexSessionInfo() {
  const direct = {
    session_id: stringField(event, ['session_id', 'sessionId', 'conversation_id']) ?? stringField(event?.payload, ['session_id', 'sessionId', 'id']),
    session_path: stringField(event, ['session_path', 'sessionPath']),
    cwd: stringField(event, ['cwd']) ?? process.cwd(),
  }
  if (direct.session_id) return direct
  return { ...fallbackCodexSession(), cwd: direct.cwd }
}

if (locator && ['codex', 'claude'].includes(kind)) {
  try {
    const headers = { 'content-type': 'application/json', 'x-muxmap-hook': '1' }
    if (process.env.MUXMAP_TOKEN) headers.authorization = `Basic ${Buffer.from(`muxmap:${process.env.MUXMAP_TOKEN}`).toString('base64')}`
    await fetch(`${process.env.MUXMAP_URL ?? 'http://127.0.0.1:4782'}/api/agent-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, locator, event: kind === 'codex' ? { ...event, muxmap: codexSessionInfo() } : event }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Agent work must never depend on the optional MuxMap observer.
  }
}
