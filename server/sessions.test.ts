import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSessionManager, defaultTerminalBackend, parseZellijSessions, type MultiplexerAdapter, type TmuxAdapter } from './sessions.ts'
import { createStore } from './store.ts'

function fakeTmux(): TmuxAdapter & { created: string[]; stopped: string[]; live: Set<string> } {
  const live = new Set<string>()
  return {
    live,
    created: [],
    stopped: [],
    exists: (name) => live.has(name),
    list: () => [...live],
    create(name) {
      this.created.push(name)
      live.add(name)
    },
    stop(name) {
      this.stopped.push(name)
      live.delete(name)
    },
  }
}

test('attaching reuses a deterministic tmux session and stopping is explicit', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-session-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'DEV-1420 session expiry',
      type: 'ticket',
      jiraKey: 'DEV-1420',
      repoPath: directory,
    })
    const first = manager.attach(node.id)
    const second = manager.attach(node.id)

    assert.equal(first.id, second.id)
    assert.equal(first.name, 'tmux:default:DEV-1420')
    assert.equal(adapter.created.length, 1)

    manager.detach(first.id)
    assert.equal(adapter.stopped.length, 0)
    assert.equal(store.getSession(first.id)?.status, 'detached')

    manager.stop(first.id)
    assert.deepEqual(adapter.stopped, ['muxmap-default-DEV-1420'])
    assert.equal(store.getSession(first.id)?.status, 'stopped')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('terminal cwd is restricted to configured repository roots', () => {
  const allowed = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-allowed-')))
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-outside-')))
  const store = createStore(':memory:')
  const manager = createSessionManager(store, fakeTmux(), [allowed])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Unsafe path',
      type: 'terminal',
      repoPath: outside,
    })
    assert.throws(() => manager.attach(node.id), /allowed/i)
  } finally {
    store.close()
    rmSync(allowed, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('Windows rejects tmux even when a tmux adapter is present', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-windows-backend-')))
  const store = createStore(':memory:')
  const tmux = fakeTmux()
  const zellij: MultiplexerAdapter = { ...fakeTmux(), backend: 'zellij' }
  const manager = createSessionManager(store, { tmux: Object.assign(tmux, { backend: 'tmux' as const }), zellij }, [directory], undefined, 'zellij', 'win32')

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Windows shell',
      type: 'terminal',
      repoPath: directory,
    })
    assert.throws(() => manager.attach(node.id, undefined, 'tmux'), /tmux.*Windows/i)
    assert.equal(manager.attach(node.id).backend, 'zellij')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('startup reconciliation marks missing tmux sessions stopped', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-reconcile-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Reconcile me',
      type: 'terminal',
      repoPath: directory,
    })
    const session = manager.attach(node.id)
    adapter.live.clear()
    manager.reconcile()
    assert.equal(store.getSession(session.id)?.status, 'stopped')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('all live muxmap-prefixed tmux sessions are inventoried and orphans can be adopted', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-orphan-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  adapter.live.add('muxmap-orphan-shell')
  adapter.live.add('unrelated-shell')
  const manager = createSessionManager(store, adapter, [directory])

  try {
    assert.deepEqual(manager.listOrphans(), [{ backend: 'tmux', runtimeName: 'muxmap-orphan-shell' }])
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Adopted shell',
      type: 'terminal',
      repoPath: directory,
    })
    const session = manager.adopt(node.id, 'tmux', 'muxmap-orphan-shell')
    assert.equal(session.nodeId, node.id)
    assert.equal(session.runtimeName, 'muxmap-orphan-shell')
    assert.deepEqual(manager.listOrphans(), [])
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('tmux descendant agents are detected and hook activity survives refresh', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-agent-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  adapter.live.add('muxmap-agent-shell')
  adapter.panes = () => [{ runtimeName: 'muxmap-agent-shell', paneId: '%9', pid: 100 }]
  const manager = createSessionManager(store, adapter, [directory], () => [
    { pid: 100, ppid: 1, command: 'bash' },
    { pid: 101, ppid: 100, command: 'node /usr/local/bin/codex' },
  ])

  try {
    assert.deepEqual(manager.listOrphans(), [{ backend: 'tmux', runtimeName: 'muxmap-agent-shell', agent: { kind: 'codex', state: 'unavailable' } }])
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%9' }, 'codex', { hook_event_name: 'UserPromptSubmit' }, '2026-08-07T10:00:00.000Z')
    assert.equal(manager.listOrphans()[0].agent?.state, 'working')
    assert.equal(manager.listOrphans()[0].agent?.since, '2026-08-07T10:00:00.000Z')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('completed agent activity stays read after reopening the workspace', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-agent-read-')))
  const database = join(directory, 'muxmap.db')
  let store = createStore(database)
  const adapter = fakeTmux()
  adapter.panes = () => [{ runtimeName: 'muxmap-default-read-me', paneId: '%10', pid: 200 }]
  const processes = () => [{ pid: 200, ppid: 1, command: 'codex' }]
  const manager = createSessionManager(store, adapter, [directory], processes)

  try {
    const node = store.createNode('default', { parentId: 'workspace', title: 'Read me', type: 'terminal', repoPath: directory })
    const session = manager.attach(node.id)
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%10' }, 'codex', { hook_event_name: 'Stop' }, '2026-08-07T10:00:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'completed')
    manager.acknowledge(session.id)
    store.close()
    store = createStore(database)
    assert.equal(createSessionManager(store, adapter, [directory], processes).decorate([session])[0].agent?.state, 'read')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Windows defaults to persistent Zellij sessions and accepts hook events by session name', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-zellij-')))
  const store = createStore(':memory:')
  const zellij: MultiplexerAdapter & { created: string[]; stopped: string[]; live: Set<string> } = {
    backend: 'zellij',
    live: new Set(),
    created: [],
    stopped: [],
    exists(name) { return this.live.has(name) },
    list() { return [...this.live] },
    create(name) { this.created.push(name); this.live.add(name) },
    stop(name) { this.stopped.push(name); this.live.delete(name) },
  }
  const manager = createSessionManager(store, { zellij }, [directory], () => [], defaultTerminalBackend('win32'))

  try {
    const node = store.createNode('default', { parentId: 'workspace', title: 'Windows task', type: 'terminal', repoPath: directory })
    const session = manager.attach(node.id)
    assert.equal(session.backend, 'zellij')
    assert.equal(session.runtimeName, 'muxmap-zellij-default-windows-task')
    assert.deepEqual(zellij.created, [session.runtimeName])

    manager.recordAgentEvent({ backend: 'zellij', runtimeName: session.runtimeName, paneId: '1' }, 'codex', { hook_event_name: 'UserPromptSubmit' })
    assert.equal(manager.decorate([session])[0].agent?.state, 'working')

    manager.stop(session.id)
    assert.deepEqual(zellij.stopped, [session.runtimeName])
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Zellij session output is parsed without terminal formatting assumptions', () => {
  assert.equal(defaultTerminalBackend('linux'), 'tmux')
  assert.equal(defaultTerminalBackend('win32'), 'zellij')
  assert.deepEqual(parseZellijSessions('muxmap-one\r\nmuxmap-two\r\n'), ['muxmap-one', 'muxmap-two'])
})
