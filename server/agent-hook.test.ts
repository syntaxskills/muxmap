import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const hookPath = fileURLToPath(new URL('./agent-hook.mjs', import.meta.url))
type CodexSessionInfo = (event: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>
const { codexSessionInfo } = await import(new URL('./agent-hook.mjs', import.meta.url).href) as { codexSessionInfo: CodexSessionInfo }

function runHook({ input = '{}', env = {}, kind = 'codex', stdio = 'ignore' }: {
  input?: string
  env?: Record<string, string | undefined>
  kind?: string
  stdio?: 'ignore' | 'pipe'
} = {}) {
  const child = spawn(process.execPath, [hookPath, kind], {
    env: { ...process.env, ...env },
    stdio: ['pipe', stdio, stdio],
  })
  assert.ok(child.stdin)
  child.stdin.end(input)
  return child
}

function createCodexSessionFixture(cwd: string, sessionId = '019fd54a-12a9-72c2-8a66-ee62fc1c546e') {
  const root = mkdtempSync(join(tmpdir(), 'muxmap-codex-hook-'))
  const sessionDir = join(root, 'sessions', '2026', '08', '11')
  mkdirSync(sessionDir, { recursive: true })
  const sessionPath = join(sessionDir, 'session.jsonl')
  writeFileSync(sessionPath, `${JSON.stringify({
    type: 'session_meta',
    payload: { session_id: sessionId, cwd },
  })}\n`)
  return { root, sessionPath, sessionId }
}

test('UserPromptSubmit without session_id does not run Codex session fallback scan', () => {
  let scanned = false
  const info = codexSessionInfo(
    { hook_event_name: 'UserPromptSubmit' },
    {
      cwd: '/repo',
      env: { CODEX_HOME: '/codex' },
      fs: {
        existsSync() {
          scanned = true
          return true
        },
        readdirSync() {
          scanned = true
          return []
        },
        readFileSync() {
          scanned = true
          return ''
        },
        statSync() {
          scanned = true
          return { mtimeMs: Date.now() }
        },
      },
    },
  )

  assert.equal(scanned, false)
  assert.deepEqual(info, { cwd: '/repo' })
})

test('SessionStart without session_id can find the matching Codex session once', () => {
  const cwd = '/tmp/muxmap-session-start'
  const fixture = createCodexSessionFixture(cwd)

  try {
    const info = codexSessionInfo({ hook_event_name: 'SessionStart' }, { cwd, env: { CODEX_HOME: fixture.root } })
    assert.equal(info.session_id, fixture.sessionId)
    assert.equal(info.session_path, fixture.sessionPath)
    assert.equal(info.cwd, cwd)
  } finally {
    if (existsSync(fixture.root)) rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('session files disappearing during fallback scan do not throw', () => {
  let statCalls = 0
  const info = codexSessionInfo(
    { hook_event_name: 'SessionStart' },
    {
      cwd: '/repo',
      env: { CODEX_HOME: '/codex' },
      fs: {
        existsSync() {
          return true
        },
        readdirSync() {
          return [{
            name: 'gone.jsonl',
            isDirectory: () => false,
            isFile: () => true,
          }]
        },
        statSync() {
          statCalls += 1
          throw new Error('file disappeared')
        },
        readFileSync() {
          throw new Error('should not read a missing file')
        },
      },
    },
  )

  assert.equal(statCalls, 1)
  assert.deepEqual(info, { cwd: '/repo' })
})

test('direct Codex session_id is used without fallback scan', () => {
  let scanned = false
  const info = codexSessionInfo(
    { hook_event_name: 'SessionStart', session_id: 'direct-session', cwd: '/repo' },
    {
      cwd: '/other',
      env: { CODEX_HOME: '/codex' },
      fs: {
        existsSync() {
          scanned = true
          return true
        },
        readdirSync() {
          scanned = true
          return []
        },
        readFileSync() {
          scanned = true
          return ''
        },
        statSync() {
          scanned = true
          return { mtimeMs: Date.now() }
        },
      },
    },
  )

  assert.equal(scanned, false)
  assert.deepEqual(info, { session_id: 'direct-session', session_path: undefined, cwd: '/repo' })
})

test('agent hook exits 0 when MuxMap API times out', { timeout: 5000 }, async () => {
  const server = createServer((_request, _response) => {
    // Keep the connection open so the hook's internal timeout path is exercised.
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  try {
    const child = runHook({
      input: '{"hook_event_name":"Stop","session_id":"direct-session"}',
      env: { TMUX_PANE: '%1', MUXMAP_URL: `http://127.0.0.1:${address.port}` },
    })
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('agent hook carries MUXMAP_TOKEN as Basic Auth', { timeout: 5000 }, async () => {
  let authorization: string | undefined
  let payload: Record<string, unknown> | undefined
  const server = createServer()
  const received = new Promise<void>((resolve) => {
    server.once('request', (request, response) => {
      authorization = request.headers.authorization
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        payload = JSON.parse(body)
        response.writeHead(202).end()
        resolve()
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  try {
    const child = runHook({
      input: '{"hook_event_name":"Stop","session_id":"019fd54a-12a9-72c2-8a66-ee62fc1c546e"}',
      env: { TMUX_PANE: '%1', MUXMAP_TOKEN: 'persistent-token', MUXMAP_URL: `http://127.0.0.1:${address.port}` },
    })
    await received
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    assert.equal(authorization, `Basic ${Buffer.from('muxmap:persistent-token').toString('base64')}`)
    const event = payload?.event as { muxmap?: { session_id?: string; cwd?: string } }
    assert.equal(event.muxmap?.session_id, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
    assert.ok(event.muxmap?.cwd)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
