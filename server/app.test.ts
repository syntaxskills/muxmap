import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import xterm from '@xterm/xterm'
import WebSocket from 'ws'
import { createMuxMapServer, defaultPtyFactory, type PtyFactory, type PtyHandle } from './app.ts'
import { realTmux, realZellij, zellijConfigPath, zellijExecutable, type TmuxAdapter } from './sessions.ts'
import type { TerminalSession } from '../src/model.ts'

const { Terminal } = xterm

function fakeTmux(): TmuxAdapter & { stopped: string[]; live: Set<string> } {
  const live = new Set<string>()
  return {
    live,
    stopped: [],
    exists: (name) => live.has(name),
    list: () => [...live],
    create: (name) => { live.add(name) },
    stop(name) {
      this.stopped.push(name)
      live.delete(name)
    },
  }
}

function fakePtyFactory(record: { writes: string[]; resizes: number[][]; kills: number[]; starts?: number[][]; scrolls?: number[] }): PtyFactory {
  return (_session, size) => {
    if (size) record.starts?.push([size.cols, size.rows])
    const dataListeners: Array<(data: string) => void> = []
    const handle: PtyHandle = {
      onData(listener) {
        dataListeners.push(listener)
        listener('ready')
      },
      onExit() {},
      write: (data) => { record.writes.push(data) },
      scroll: (lines) => { record.scrolls?.push(lines) },
      resize: (cols, rows) => { record.resizes.push([cols, rows]) },
      kill: () => { record.kills.push(1) },
    }
    return handle
  }
}

async function eventually(predicate: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(predicate(), true)
}

test('secured workspace and node APIs return persisted graph data', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-api-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const unauthenticated = await fetch(`${base}/api/workspaces/default`)
    assert.equal(unauthenticated.status, 401)

    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const forbidden = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Blocked', type: 'note' }),
    })
    assert.equal(forbidden.status, 403)

    const created = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'API child', type: 'note' }),
    })
    assert.equal(created.status, 201)
    const createdNode = await created.json() as { id: string }

    const renamed = await fetch(`${base}/api/nodes/${createdNode.id}`, {
      method: 'PATCH',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed in place', type: 'todo' }),
    })
    assert.equal(renamed.status, 200)
    const renamedNode = await renamed.json() as { title: string; type: string }
    assert.equal(renamedNode.title, 'Renamed in place')
    assert.equal(renamedNode.type, 'todo')

    const second = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Second child', type: 'note' }),
    })
    const secondNode = await second.json() as { id: string }
    const reordered = await fetch(`${base}/api/nodes/${secondNode.id}/reorder`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: createdNode.id, position: 'before' }),
    })
    assert.equal(reordered.status, 200)
    const reorderedNodes = await reordered.json() as { nodes: Array<{ id: string }> }
    assert.deepEqual(reorderedNodes.nodes.filter((node) => node.id === createdNode.id || node.id === secondNode.id).map((node) => node.id), [secondNode.id, createdNode.id])

    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })
    const graph = await workspace.json() as { nodes: Array<{ id: string; title: string; type: string }>; runtime: { platform: string; terminalBackends: string[] } }
    assert.equal(graph.nodes.some((node) => node.id === createdNode.id), true)
    assert.equal(graph.nodes.find((node) => node.id === createdNode.id)?.title, 'Renamed in place')
    assert.equal(graph.nodes.find((node) => node.id === createdNode.id)?.type, 'todo')
    assert.equal(graph.runtime.platform, 'linux')
    assert.equal(graph.runtime.terminalBackends.includes('tmux'), true)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('LAN mode requires persistent basic auth before issuing its session cookie', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-lan-auth-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'persistent-token',
    requireBasicAuth: true,
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const denied = await fetch(`${base}/api/auth`)
    assert.equal(denied.status, 401)
    assert.match(denied.headers.get('www-authenticate') ?? '', /^Basic /)

    const auth = await fetch(`${base}/api/auth`, {
      headers: { authorization: `Basic ${Buffer.from('muxmap:persistent-token').toString('base64')}` },
    })
    assert.equal(auth.status, 200)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    assert.equal((await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })).status, 200)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('websocket detaches safely and workspace refresh surfaces a missing tmux session', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-ws-')))
  const tmux = fakeTmux()
  const ptyRecord = { writes: [] as string[], resizes: [] as number[][], kills: [] as number[], starts: [] as number[][], scrolls: [] as number[] }
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory(ptyRecord),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const nodeResponse = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Shell task', type: 'terminal', repoPath: root }),
    })
    const node = await nodeResponse.json() as { id: string }
    const sessionResponse = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    })
    const { session } = await sessionResponse.json() as { session: { id: string } }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach?cols=84&rows=27`, {
      headers: { cookie, origin: base },
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    ws.send(JSON.stringify({ type: 'input', data: 'pwd\r' }))
    ws.send(JSON.stringify({ type: 'scroll', lines: -4 }))
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 36 }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const connectedGraph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: Array<{ id: string; status: string }> }
    assert.equal(connectedGraph.sessions.find((item) => item.id === session.id)?.status, 'running')
    ws.close()
    await new Promise((resolve) => ws.once('close', resolve))
    await eventually(() => ptyRecord.kills.length === 1)

    assert.deepEqual(ptyRecord.writes, ['pwd\r'])
    assert.deepEqual(ptyRecord.scrolls, [-4])
    assert.deepEqual(ptyRecord.starts, [[84, 27]])
    assert.deepEqual(ptyRecord.resizes, [[120, 36]])
    assert.equal(ptyRecord.kills.length, 1)
    assert.equal(tmux.stopped.length, 0)
    assert.equal(server.store.getSession(session.id)?.status, 'detached')

    const reopened = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach`, {
      headers: { cookie, origin: base },
    })
    await new Promise<void>((resolve, reject) => {
      reopened.once('open', resolve)
      reopened.once('error', reject)
    })
    reopened.close()
    await new Promise((resolve) => reopened.once('close', resolve))
    await eventually(() => ptyRecord.kills.length === 2)
    assert.equal(ptyRecord.kills.length, 2)
    assert.equal(tmux.stopped.length, 0)

    tmux.live.clear()
    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })
    const graph = await workspace.json() as { sessions: Array<{ id: string; status: string }> }
    assert.equal(graph.sessions.find((item) => item.id === session.id)?.status, 'stopped')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a PTY launch failure closes only the terminal connection and keeps the API alive', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-pty-failure-')))
  const tmux = fakeTmux()
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: () => { throw new Error('posix_spawnp failed') },
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const nodeResponse = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Broken shell', type: 'terminal', repoPath: root }),
    })
    const node = await nodeResponse.json() as { id: string }
    const sessionResponse = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    })
    const { session } = await sessionResponse.json() as { session: { id: string } }

    const webSocket = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach`, {
      headers: { cookie, origin: base },
    })
    const closed = new Promise<number>((resolve) => webSocket.once('close', resolve))
    await closed

    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })
    assert.equal(workspace.status, 200)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real node-pty adapter attaches to tmux and streams shell output', {
  skip: spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status !== 0,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-real-pty-')))
  const runtimeName = `muxmap-test-${process.pid}-${Date.now()}`
  const inheritedTmux = process.env.TMUX
  process.env.TMUX = '/tmp/map-services.sock,1,0'

  const session: TerminalSession = {
    id: `sess_${runtimeName}`,
    workspaceId: 'default',
    nodeId: 'test-node',
    name: `tmux:default:${runtimeName}`,
    runtimeName,
    backend: 'tmux',
    cwd: root,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  let pty: ReturnType<typeof defaultPtyFactory> | undefined

  try {
    realTmux.create(runtimeName, root)
    assert.equal(spawnSync('tmux', ['-L', 'default', 'has-session', '-t', runtimeName]).status, 0)
    const activePty = defaultPtyFactory(session)
    pty = activePty
    const mouse = spawnSync('tmux', ['-L', 'default', 'show-options', '-v', '-t', runtimeName, 'mouse'], { encoding: 'utf8' })
    assert.equal(mouse.stdout.trim(), 'on', 'browser terminals need tmux copy-mode scrolling')
    const marker = '__MUXMAP_REAL_PTY_OK__'
    const output = await new Promise<string>((resolve, reject) => {
      let received = ''
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for real PTY output: ${received}`)), 3000)
      activePty.onData((data) => {
        received += data
        if (received.split(marker).length > 2) {
          clearTimeout(timeout)
          resolve(received)
        }
      })
      activePty.write(`for i in {1..40}; do echo "history-$i"; done; printf '${marker}\\n'\r`)
    })
    assert.match(output, /__MUXMAP_REAL_PTY_OK__/)
    activePty.scroll(-3)
    activePty.scroll(-3)
    let scrollPosition = ''
    await eventually(() => {
      scrollPosition = spawnSync('tmux', ['-L', 'default', 'display-message', '-p', '-t', runtimeName, '#{pane_in_mode} #{scroll_position}'], { encoding: 'utf8' }).stdout.trim()
      return scrollPosition.startsWith('1 ')
    })
    assert.match(scrollPosition, /^1 /, 'scrolling must enter tmux history mode')
  } finally {
    if (inheritedTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = inheritedTmux
    pty?.kill()
    if (realTmux.exists(runtimeName)) realTmux.stop(runtimeName)
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real node-pty adapter reattaches to a persistent Zellij session', {
  skip: process.platform === 'win32' && process.env.CI
    ? 'Zellij 0.44.3 IPC is not usable in a non-interactive Windows Actions host'
    : spawnSync(zellijExecutable(), ['--version'], { stdio: 'ignore' }).status !== 0,
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-real-zellij-')))
  const runtimeName = `muxmap-zellij-test-${process.pid}-${Date.now()}`
  const session: TerminalSession = {
    id: `sess_${runtimeName}`,
    workspaceId: 'default',
    nodeId: 'test-zellij-node',
    name: `zellij:default:${runtimeName}`,
    runtimeName,
    backend: 'zellij',
    cwd: root,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  let pty: ReturnType<typeof defaultPtyFactory> | undefined

  const detach = (activePty: ReturnType<typeof defaultPtyFactory>) => new Promise<void>((resolve) => {
    activePty.onExit(resolve)
    activePty.kill()
  })

  const proveShell = (activePty: ReturnType<typeof defaultPtyFactory>, marker: string) => new Promise<string>((resolve, reject) => {
    const terminal = new Terminal({ cols: 100, rows: 30 })
    let received = ''
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Zellij PTY output: ${received}`)), 8000)
    terminal.onData((data) => activePty.write(data))
    activePty.onData((data) => {
      received += data
      terminal.write(data)
      if (received.split(marker).length > 2) {
        clearTimeout(timeout)
        resolve(received)
      }
    })
    activePty.write(`echo ${marker}\r`)
  })

  try {
    pty = defaultPtyFactory(session)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await proveShell(pty, '__MUXMAP_ZELLIJ_FIRST__')
    await eventually(() => realZellij.exists(runtimeName), 5000)
    await detach(pty)
    pty = undefined
    await eventually(() => realZellij.exists(runtimeName), 5000)

    pty = defaultPtyFactory(session)
    await proveShell(pty, '__MUXMAP_ZELLIJ_REATTACHED__')
  } finally {
    if (pty) await detach(pty)
    if (realZellij.exists(runtimeName)) realZellij.stop(runtimeName)
    await eventually(() => !realZellij.exists(runtimeName), 5000)
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  assert.equal(realZellij.exists(runtimeName), false)
})

test('Windows accepts the MuxMap Zellij config', {
  skip: process.platform !== 'win32',
}, () => {
  const config = spawnSync(zellijExecutable(), ['--config', zellijConfigPath(), 'setup', '--check'], { encoding: 'utf8' })
  assert.equal(config.status, 0, config.stderr)
})

test('orphan tmux sessions can be adopted and node deletion explicitly keeps or stops tmux', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-orphan-api-')))
  const tmux = fakeTmux()
  tmux.live.add('muxmap-external-shell')
  tmux.live.add('unrelated-shell')
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }

    const initial = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { orphans: Array<{ backend: string; runtimeName: string }> }
    assert.deepEqual(initial.orphans, [{ backend: 'tmux', runtimeName: 'muxmap-external-shell' }])

    const adoptNode = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Adopt target', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const adopted = await fetch(`${base}/api/sessions/adopt-orphan`, {
      method: 'POST', headers, body: JSON.stringify({ nodeId: adoptNode.id, backend: 'tmux', runtimeName: 'muxmap-external-shell' }),
    })
    assert.equal(adopted.status, 200)

    const orphanNode = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Keep shell', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const orphanSession = await fetch(`${base}/api/nodes/${orphanNode.id}/session`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { runtimeName: string } }
    const kept = await fetch(`${base}/api/nodes/${orphanNode.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ stopSession: false }),
    })
    assert.equal(kept.status, 200)
    assert.equal(tmux.live.has(orphanSession.session.runtimeName), true)

    const stopNode = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Stop shell', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const stoppedSession = await fetch(`${base}/api/nodes/${stopNode.id}/session`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { runtimeName: string } }
    const stopped = await fetch(`${base}/api/nodes/${stopNode.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ stopSession: true }),
    })
    assert.equal(stopped.status, 200)
    assert.equal(tmux.live.has(stoppedSession.session.runtimeName), false)

    const final = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { orphans: Array<{ runtimeName: string }> }
    assert.equal(final.orphans.some((orphan) => orphan.runtimeName === orphanSession.session.runtimeName), true)
    assert.equal(final.orphans.some((orphan) => orphan.runtimeName === 'unrelated-shell'), false)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('local agent hooks update automatically detected tmux activity', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-agent-api-')))
  const tmux = fakeTmux()
  tmux.live.add('muxmap-codex-work')
  tmux.panes = () => [{ runtimeName: 'muxmap-codex-work', paneId: '%7', pid: 700 }]
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    requireBasicAuth: true,
    tmux,
    processReader: () => [
      { pid: 700, ppid: 1, command: 'bash' },
      { pid: 701, ppid: 700, command: 'node /usr/local/bin/codex' },
    ],
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const rejected = await fetch(`${base}/api/agent-events`, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'x-muxmap-hook': '1', 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(rejected.status, 403)

    const event = await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'UserPromptSubmit' } }),
    })
    assert.equal(event.status, 202)

    const auth = await fetch(`${base}/api/auth`, {
      headers: { authorization: `Basic ${Buffer.from('muxmap:test-token').toString('base64')}` },
    })
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const graph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as {
      orphans: Array<{ agent?: { kind: string; state: string; since?: string } }>
    }
    assert.equal(graph.orphans[0].agent?.kind, 'codex')
    assert.equal(graph.orphans[0].agent?.state, 'working')
    assert.ok(graph.orphans[0].agent?.since)

    const completed = await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'Stop' } }),
    })
    assert.equal(completed.status, 202)
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Agent task', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const adopted = await fetch(`${base}/api/sessions/adopt-orphan`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: node.id, backend: 'tmux', runtimeName: 'muxmap-codex-work' }),
    }).then((response) => response.json()) as { session: TerminalSession }
    const unread = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    assert.equal(unread.sessions.find((session) => session.id === adopted.session.id)?.agent?.state, 'completed')

    const acknowledged = await fetch(`${base}/api/sessions/${adopted.session.id}/agent/read`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(acknowledged.status, 200)
    const read = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    assert.equal(read.sessions.find((session) => session.id === adopted.session.id)?.agent?.state, 'read')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
