import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { agentResumeCommand, createSessionManager, createShortTtlCache, createStaleWhileRevalidateCache, defaultTerminalBackend, parseZellijSessions, tmuxExecutable, tmuxNewSessionArgs, type MultiplexerAdapter, type TmuxAdapter } from './sessions.ts'
import { createStore } from './store.ts'
import type { ProcessInfo } from './agents.ts'

function fakeTmux(): TmuxAdapter & { created: string[]; createCommands: Array<string[] | undefined>; createEnvs: Array<Record<string, string> | undefined>; stopped: string[]; live: Set<string> } {
  const live = new Set<string>()
  return {
    live,
    created: [],
    createCommands: [],
    createEnvs: [],
    stopped: [],
    exists: (name) => live.has(name),
    list: () => [...live],
    create(name, _cwd, command, sessionEnv) {
      this.created.push(name)
      this.createCommands.push(command)
      this.createEnvs.push(sessionEnv)
      live.add(name)
    },
    stop(name) {
      this.stopped.push(name)
      live.delete(name)
    },
  }
}

test('short TTL cache reuses values until expiry and refreshes after', () => {
  let now = 1000
  let loads = 0
  const cache = createShortTtlCache(() => {
    loads++
    return { value: loads }
  }, 2500, () => now)

  assert.deepEqual(cache.get(), { value: 1 })
  now += 2499
  assert.deepEqual(cache.get(), { value: 1 })
  now += 1
  assert.deepEqual(cache.get(), { value: 2 })
  assert.equal(loads, 2)
})

test('short TTL cache invalidates immediately on mutation', () => {
  let loads = 0
  const cache = createShortTtlCache(() => ++loads, 2500, () => 1000)

  assert.equal(cache.get(), 1)
  assert.equal(cache.get(), 1)
  cache.invalidate()
  assert.equal(cache.get(), 2)
})

test('stale runtime cache serves the last snapshot while refreshing in the background', async () => {
  let now = 1000
  let loads = 0
  let releaseRefresh: ((value: { value: number }) => void) | undefined
  const cache = createStaleWhileRevalidateCache(() => new Promise<{ value: number }>((resolve) => {
    loads++
    releaseRefresh = resolve
  }), { value: 0 }, 2500, () => now)

  assert.deepEqual(cache.get(), { value: 0 })
  await Promise.resolve()
  assert.equal(loads, 1)
  assert.deepEqual(cache.get(), { value: 0 })
  const inFlight = cache.inFlight()
  releaseRefresh?.({ value: 1 })
  assert.deepEqual(await inFlight, { value: 1 })
  assert.deepEqual(cache.get(), { value: 1 })

  now += 2500
  assert.deepEqual(cache.get(), { value: 1 })
  assert.deepEqual(cache.get(), { value: 1 })
  await Promise.resolve()
  assert.equal(loads, 2)
})

test('stale runtime cache coalesces concurrent forced refreshes', async () => {
  let loads = 0
  const cache = createStaleWhileRevalidateCache(async () => {
    loads++
    return { value: loads }
  }, { value: 0 }, 2500)

  const [first, second, third] = await Promise.all([cache.refresh(), cache.refresh(), cache.refresh()])

  assert.deepEqual(first, { value: 1 })
  assert.deepEqual(second, { value: 1 })
  assert.deepEqual(third, { value: 1 })
  assert.equal(loads, 1)
})

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

test('new tmux node sessions receive MuxMap MCP context environment and reattach does not recreate it', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-session-env-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory], undefined, undefined, undefined, {
    muxMapUrl: 'http://127.0.0.1:61234',
  })

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Report lifecycle',
      type: 'terminal',
      repoPath: directory,
    })

    const session = manager.attach(node.id)
    const reattached = manager.attach(node.id)

    assert.equal(session.id, `sess_${node.id}`)
    assert.equal(reattached.id, session.id)
    assert.deepEqual(adapter.createEnvs, [{
      MUXMAP_NODE_ID: node.id,
      MUXMAP_SESSION_ID: session.id,
      MUXMAP_URL: 'http://127.0.0.1:61234',
    }])
    assert.deepEqual(tmuxNewSessionArgs(session.runtimeName, directory, undefined, adapter.createEnvs[0]), [
      '-L', 'default',
      'new-session', '-d',
      '-s', session.runtimeName,
      '-c', directory,
      '-e', `MUXMAP_NODE_ID=${node.id}`,
      '-e', `MUXMAP_SESSION_ID=${session.id}`,
      '-e', 'MUXMAP_URL=http://127.0.0.1:61234',
    ])
    assert.equal(adapter.created.length, 1)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('runtime discovery snapshot is shared within the TTL and invalidated by terminal mutations', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-discovery-cache-')))
  const store = createStore(':memory:')
  let processReads = 0
  let paneReads = 0
  let listReads = 0
  const adapter = {
    ...fakeTmux(),
    list() {
      listReads++
      return [...this.live]
    },
    panes() {
      paneReads++
      return [...this.live].map((runtimeName, index) => ({ runtimeName, paneId: `%${index + 1}`, pid: 1000 + index }))
    },
  }
  const manager = createSessionManager(store, adapter, [directory], () => {
    processReads++
    return []
  })

  try {
    manager.discoverySnapshot()
    manager.discoverySnapshot()

    assert.equal(processReads, 1)
    assert.equal(paneReads, 1)
    assert.equal(listReads, 1)

    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Cached runtime',
      type: 'terminal',
      repoPath: directory,
    })
    manager.attach(node.id)
    manager.discoverySnapshot()

    assert.equal(processReads, 2)
    assert.equal(paneReads, 2)
    assert.equal(listReads, 2)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('async runtime discovery returns stale snapshots during in-flight refresh and force-refreshes after invalidation', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-async-discovery-cache-')))
  const store = createStore(':memory:')
  let now = 1000
  let listReads = 0
  let paneReads = 0
  let processReads = 0
  const live = new Set(['muxmap-old'])
  let releaseProcesses: ((processes: ProcessInfo[]) => void) | undefined
  const adapter = {
    ...fakeTmux(),
    live,
    async listAsync() {
      listReads++
      return [...live]
    },
    async panesAsync() {
      paneReads++
      return [...live].map((runtimeName, index) => ({ runtimeName, paneId: `%${index + 1}`, pid: 1000 + index }))
    },
  }
  const manager = createSessionManager(store, adapter, [directory], () => [], undefined, undefined, {
    clock: () => now,
    processReaderAsync: () => new Promise((resolve) => {
      processReads++
      releaseProcesses = resolve
    }),
  })

  try {
    const initialRefresh = manager.refreshRuntimeDiscovery()
    await Promise.resolve()
    releaseProcesses?.([])
    assert.deepEqual([...(await initialRefresh).live.get('tmux') ?? []], ['muxmap-old'])

    live.clear()
    live.add('muxmap-new')
    now += 2500
    assert.deepEqual([...manager.discoverySnapshot().live.get('tmux') ?? []], ['muxmap-old'])
    assert.deepEqual([...manager.discoverySnapshot().live.get('tmux') ?? []], ['muxmap-old'])
    await Promise.resolve()
    assert.equal(processReads, 2)
    assert.equal(listReads, 2)
    assert.equal(paneReads, 2)

    const refresh = manager.refreshRuntimeDiscovery()
    await Promise.resolve()
    releaseProcesses?.([])
    assert.deepEqual([...(await refresh).live.get('tmux') ?? []], ['muxmap-new'])
    assert.equal(processReads, 2)
    assert.equal(listReads, 2)
    assert.equal(paneReads, 2)

    live.clear()
    live.add('muxmap-forced')
    manager.invalidateRuntimeDiscovery()
    const forced = manager.refreshRuntimeDiscovery()
    await Promise.resolve()
    releaseProcesses?.([])
    assert.deepEqual([...(await forced).live.get('tmux') ?? []], ['muxmap-forced'])
    assert.equal(processReads, 3)
    assert.equal(listReads, 3)
    assert.equal(paneReads, 3)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attaching a tracked live session uses cached runtime discovery instead of exists', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-attach-cache-')))
  const store = createStore(':memory:')
  let existsReads = 0
  let listReads = 0
  const adapter = {
    ...fakeTmux(),
    exists(name: string) {
      existsReads++
      return this.live.has(name)
    },
    list() {
      listReads++
      return [...this.live]
    },
  }
  const manager = createSessionManager(store, adapter, [directory], () => [])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Cached attach',
      type: 'terminal',
      repoPath: directory,
    })
    const session = manager.attach(node.id)
    assert.ok(existsReads >= 1)

    existsReads = 0
    const trusted = manager.attach(node.id)
    assert.equal(trusted.id, session.id)
    assert.equal(existsReads, 0)

    manager.discoverySnapshot()
    existsReads = 0
    listReads = 0
    const reattached = manager.attach(node.id)

    assert.equal(reattached.id, session.id)
    assert.equal(existsReads, 0)
    assert.equal(listReads, 0)
    assert.deepEqual(adapter.created, [session.runtimeName])
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('duplicate node labels allocate distinct tmux session names instead of sharing a runtime', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-duplicate-label-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const firstNode = store.createNode('default', {
      parentId: 'workspace',
      title: 'Run tests',
      type: 'terminal',
      repoPath: directory,
    })
    const secondNode = store.createNode('default', {
      parentId: 'workspace',
      title: 'Run tests',
      type: 'terminal',
      repoPath: directory,
    })

    const first = manager.attach(firstNode.id)
    const second = manager.attach(secondNode.id)

    assert.equal(first.runtimeName, 'muxmap-default-run-tests')
    assert.notEqual(second.runtimeName, first.runtimeName)
    assert.match(second.runtimeName, /^muxmap-default-run-tests-[a-zA-Z0-9]+/)
    assert.deepEqual(adapter.created, [first.runtimeName, second.runtimeName])
    assert.equal(store.getSessionByRuntimeName(first.runtimeName)?.nodeId, firstNode.id)
    assert.equal(store.getSessionByRuntimeName(second.runtimeName)?.nodeId, secondNode.id)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stopped node sessions can start a fresh terminal instead of reusing the old runtime', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-start-new-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Switch agent',
      type: 'terminal',
      repoPath: directory,
    })
    const oldSession = manager.attach(node.id)
    manager.stop(oldSession.id)
    store.upsertAgentActivity(oldSession.runtimeName, { kind: 'codex', state: 'working', since: '2026-08-07T10:00:00.000Z', externalSessionId: 'codex-session' })

    const fresh = manager.startNew(node.id)

    assert.equal(fresh.id, oldSession.id)
    assert.equal(fresh.status, 'running')
    assert.notEqual(fresh.runtimeName, oldSession.runtimeName)
    assert.equal(fresh.runtimeName, 'muxmap-default-switch-agent-' + node.id.replace(/-/g, '').slice(0, 8))
    assert.deepEqual(adapter.created, [oldSession.runtimeName, fresh.runtimeName])
    assert.equal(store.getSessionByRuntimeName(oldSession.runtimeName), undefined)
    assert.equal(store.getAgentActivity(oldSession.runtimeName)?.externalSessionId, 'codex-session')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stopped Claude and Pi sessions can resume with their agent session metadata', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-agent-recover-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const claudeNode = store.createNode('default', { parentId: 'workspace', title: 'Claude recover', type: 'terminal', repoPath: directory })
    const claudeSession = manager.attach(claudeNode.id)
    manager.stop(claudeSession.id)
    store.upsertAgentActivity(claudeSession.runtimeName, { kind: 'claude', state: 'completed', since: '2026-08-07T10:00:00.000Z', externalSessionId: 'claude-session' })

    const piNode = store.createNode('default', { parentId: 'workspace', title: 'Pi recover', type: 'terminal', repoPath: directory })
    const piSession = manager.attach(piNode.id)
    manager.stop(piSession.id)
    store.upsertAgentActivity(piSession.runtimeName, { kind: 'pi', state: 'completed', since: '2026-08-07T10:01:00.000Z', externalSessionPath: '/home/me/.pi/agent/sessions/pi.jsonl' })

    assert.deepEqual(agentResumeCommand(store.getAgentActivity(claudeSession.runtimeName)!), ['claude', '--resume', 'claude-session'])
    assert.deepEqual(agentResumeCommand(store.getAgentActivity(piSession.runtimeName)!), ['pi', '--session', '/home/me/.pi/agent/sessions/pi.jsonl'])
    assert.equal(manager.decorate([store.getSession(claudeSession.id)!])[0].canRecoverAgent, true)
    assert.equal(manager.decorate([store.getSession(piSession.id)!])[0].canRecoverAgent, true)

    manager.recoverAgent(claudeSession.id)
    manager.recoverAgent(piSession.id)

    assert.deepEqual(adapter.createCommands.slice(-2), [
      ['claude', '--resume', 'claude-session'],
      ['pi', '--session', '/home/me/.pi/agent/sessions/pi.jsonl'],
    ])
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attaching avoids adopting a live orphan with the same computed tmux name', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-orphan-name-collision-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  adapter.live.add('muxmap-default-run-tests')
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Run tests',
      type: 'terminal',
      repoPath: directory,
    })
    const session = manager.attach(node.id)

    assert.notEqual(session.runtimeName, 'muxmap-default-run-tests')
    assert.match(session.runtimeName, /^muxmap-default-run-tests-[a-zA-Z0-9]+/)
    assert.deepEqual(manager.listOrphans(), [{ backend: 'tmux', runtimeName: 'muxmap-default-run-tests' }])
    assert.equal(adapter.live.has(session.runtimeName), true)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('workspace decoration reuses one runtime snapshot instead of checking each session', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-runtime-snapshot-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const originalExists = adapter.exists.bind(adapter)
  const originalList = adapter.list.bind(adapter)
  let existsCalls = 0
  let listCalls = 0
  adapter.exists = (name) => {
    existsCalls++
    return originalExists(name)
  }
  adapter.list = () => {
    listCalls++
    return originalList()
  }
  const manager = createSessionManager(store, adapter, [directory])

  try {
    for (const title of ['One', 'Two', 'Three']) {
      const node = store.createNode('default', {
        parentId: 'workspace',
        title,
        type: 'terminal',
        repoPath: directory,
      })
      manager.attach(node.id)
    }

    existsCalls = 0
    listCalls = 0
    const live = manager.reconcile()
    const inventory = manager.inventory()
    const decorated = manager.decorate(store.listSessions(), inventory, live)
    const orphans = manager.listOrphans(inventory, live)

    assert.equal(decorated.length, 3)
    assert.deepEqual(orphans, [])
    assert.equal(listCalls, 1)
    assert.equal(existsCalls, 0)
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

test('suspended sessions release their runtime and can resume the same name', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-suspend-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', {
      parentId: 'workspace',
      title: 'Suspend me',
      type: 'terminal',
      repoPath: directory,
    })
    const session = manager.attach(node.id)
    assert.equal(adapter.live.has(session.runtimeName), true)

    manager.suspend(session.id)
    assert.equal(store.getSession(session.id)?.status, 'suspended')
    assert.equal(adapter.live.has(session.runtimeName), false)
    assert.deepEqual(adapter.stopped, [session.runtimeName])

    manager.reconcile()
    assert.equal(store.getSession(session.id)?.status, 'suspended')

    const resumed = manager.attach(node.id)
    assert.equal(resumed.runtimeName, session.runtimeName)
    assert.equal(resumed.status, 'running')
    assert.equal(adapter.live.has(session.runtimeName), true)
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('auto suspend releases the oldest quiet sessions above the active limit', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-auto-suspend-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const sessions = ['Protected working', 'Old quiet', 'Newer quiet', 'Current terminal'].map((title, index) => {
      const node = store.createNode('default', { parentId: 'workspace', title, type: 'terminal', repoPath: directory })
      const session = manager.attach(node.id)
      store.updateSessionActivity(session.id, `2026-08-07T10:0${index}:00.000Z`)
      return session
    })
    store.upsertAgentActivity(sessions[0].runtimeName, { kind: 'codex', state: 'working', since: '2026-08-07T10:00:00.000Z' })

    const suspended = manager.autoSuspend(2, sessions[3].id)

    assert.deepEqual(suspended.map((session) => session.runtimeName), [sessions[1].runtimeName, sessions[2].runtimeName])
    assert.equal(store.getSession(sessions[0].id)?.status, 'running')
    assert.equal(store.getSession(sessions[1].id)?.status, 'suspended')
    assert.equal(store.getSession(sessions[2].id)?.status, 'suspended')
    assert.equal(store.getSession(sessions[3].id)?.status, 'running')
    assert.equal(adapter.live.has(sessions[1].runtimeName), false)
    assert.equal(adapter.live.has(sessions[2].runtimeName), false)
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

test('MuxMap self-hosting sessions are protected instead of listed as orphans', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-self-host-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  adapter.live.add('muxmap-web')
  adapter.live.add('muxmap-external-shell')
  adapter.panes = () => [
    { runtimeName: 'muxmap-web', paneId: '%1', pid: 1000 },
    { runtimeName: 'muxmap-external-shell', paneId: '%2', pid: 2000 },
  ]
  const manager = createSessionManager(store, adapter, [directory], () => [
    { pid: 1000, ppid: 1, command: 'zsh' },
    { pid: 1001, ppid: 1000, command: 'node scripts/dev.mjs' },
    { pid: 1002, ppid: 1001, command: 'node --experimental-strip-types server/index.ts' },
    { pid: 2000, ppid: 1, command: 'zsh' },
    { pid: 2001, ppid: 2000, command: 'node /usr/local/bin/codex' },
  ])

  try {
    assert.deepEqual(manager.listOrphans(), [{ backend: 'tmux', runtimeName: 'muxmap-external-shell', agent: { kind: 'codex', state: 'unavailable' } }])
    assert.deepEqual(manager.listSelfHosting(), [{ backend: 'tmux', runtimeName: 'muxmap-web', role: 'self_hosting' }])
    const node = store.createNode('default', { parentId: 'workspace', title: 'Host', type: 'terminal', repoPath: directory })
    assert.throws(() => manager.adopt(node.id, 'tmux', 'muxmap-web'), /hosting MuxMap/)
    assert.throws(() => manager.stopRuntime('tmux', 'muxmap-web'), /hosting MuxMap/)
    assert.equal(adapter.live.has('muxmap-web'), true)
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
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%9' }, 'codex', { hook_event_name: 'UserPromptSubmit', session_id: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' }, '2026-08-07T10:00:00.000Z')
    assert.equal(manager.listOrphans()[0].agent?.state, 'working')
    assert.equal(manager.listOrphans()[0].agent?.since, '2026-08-07T10:00:00.000Z')
    assert.equal(manager.listOrphans()[0].agent?.externalSessionId, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
    assert.equal(store.listAgentEvents('muxmap-agent-shell')[0]?.eventName, 'UserPromptSubmit')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('stopped Codex sessions can be recreated with codex resume', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-codex-recover-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  adapter.panes = () => [{ runtimeName: 'muxmap-default-recover-me', paneId: '%11', pid: 300 }]
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', { parentId: 'workspace', title: 'Recover me', type: 'terminal', repoPath: directory })
    const session = manager.attach(node.id)
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%11' }, 'codex', { hook_event_name: 'Stop', session_id: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' })
    adapter.live.clear()
    manager.reconcile()

    const recovered = manager.recoverCodex(session.id)
    assert.equal(recovered.status, 'running')
    assert.equal(adapter.created.at(-1), session.runtimeName)
    assert.deepEqual(adapter.createCommands.at(-1), ['codex', 'resume', '019fd54a-12a9-72c2-8a66-ee62fc1c546e'])
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('working Codex activity is recoverable when its tmux runtime is missing', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-codex-working-recover-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  adapter.panes = () => [{ runtimeName: 'muxmap-default-working-recover', paneId: '%13', pid: 310 }]
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', { parentId: 'workspace', title: 'Working recover', type: 'terminal', repoPath: directory })
    const session = manager.attach(node.id)
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%13' }, 'codex', { hook_event_name: 'UserPromptSubmit', session_id: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' })
    adapter.live.clear()
    manager.reconcile()

    const decorated = manager.decorate([store.getSession(session.id)!])[0]
    assert.equal(store.getSession(session.id)?.status, 'running')
    assert.equal(decorated.agent?.state, 'working')
    assert.equal(decorated.runtimeExists, false)
    assert.equal(decorated.canRecoverCodex, true)
    assert.equal(decorated.canBulkRecoverAgent, true)
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
    assert.equal(store.getSession(session.id)?.lastActivityAt, '2026-08-07T10:00:00.000Z')
    manager.acknowledge(session.id)
    store.close()
    store = createStore(database)
    assert.equal(createSessionManager(store, adapter, [directory], processes).decorate([session])[0].agent?.state, 'read')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('Claude idle prompts downgrade stuck states but preserve needs input', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-agent-preserve-')))
  const store = createStore(':memory:')
  const adapter = fakeTmux()
  const manager = createSessionManager(store, adapter, [directory])

  try {
    const node = store.createNode('default', { parentId: 'workspace', title: 'Claude preserve', type: 'terminal', repoPath: directory })
    const session = manager.attach(node.id)
    adapter.panes = () => [{ runtimeName: session.runtimeName, paneId: '%21', pid: 2100 }]

    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'PermissionRequest' }, '2026-08-07T10:00:00.000Z')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, '2026-08-07T10:01:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'needs_input')
    assert.equal(store.getSession(session.id)?.lastActivityAt, '2026-08-07T10:00:00.000Z')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { payload: { hookEventName: 'PreToolUse' } }, '2026-08-07T10:01:30.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'working')

    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Stop' }, '2026-08-07T10:02:00.000Z')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'SubagentStop', agent_id: 'agent-late' }, '2026-08-07T10:03:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'completed')
    assert.deepEqual(store.listAgentEvents(session.runtimeName).map((event) => [event.eventName, event.state]), [
      ['SubagentStop', 'completed'],
      ['Stop', 'completed'],
      ['PreToolUse', 'working'],
      ['Notification', 'needs_input'],
      ['PermissionRequest', 'needs_input'],
    ])

    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'PreToolUse' }, '2026-08-07T10:04:00.000Z')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Stop', background_tasks: [{ id: 'task-1', description: 'Run mvn test' }] }, '2026-08-07T10:05:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'delegated')
    manager.acknowledge(session.id)
    assert.equal(manager.decorate([session])[0].agent?.state, 'delegated')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, '2026-08-07T10:05:15.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'delegated')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Stop', background_tasks: [{ id: 'task-1', description: 'Run mvn test' }] }, '2026-08-07T10:05:30.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'delegated')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'TaskCompleted', task_id: 'task-1' }, '2026-08-07T10:06:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'delegated')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Stop', background_tasks: [{ id: 'artifact-1', type: 'monitor', description: 'live updates for artifact demo' }] }, '2026-08-07T10:06:30.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'standby')
    assert.equal(manager.decorate([session])[0].agent?.standbyReason, 'live updates for artifact demo')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, '2026-08-07T10:06:45.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'standby')
    manager.acknowledge(session.id)
    assert.equal(manager.decorate([session])[0].agent?.state, 'read')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'PreToolUse' }, '2026-08-07T10:07:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'working')
    manager.recordAgentEvent({ backend: 'tmux', paneId: '%21' }, 'claude', { hook_event_name: 'Stop', background_tasks: [], session_crons: [] }, '2026-08-07T10:08:00.000Z')
    assert.equal(manager.decorate([session])[0].agent?.state, 'completed')
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

test('tmux executable can be configured or resolved from PATH for PTY compatibility', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-tmux-bin-'))
  const executable = join(directory, 'tmux')

  try {
    writeFileSync(executable, '#!/bin/sh\nexit 0\n')
    chmodSync(executable, 0o755)

    assert.equal(tmuxExecutable('darwin', { MUXMAP_TMUX_BIN: '/custom/tmux', PATH: '' }), '/custom/tmux')
    assert.equal(tmuxExecutable('darwin', { PATH: ['/missing', directory].join(delimiter) }), executable)
    assert.equal(tmuxExecutable('darwin', { PATH: '/missing' }), 'tmux')
    assert.equal(tmuxExecutable('win32', { PATH: directory }), 'tmux')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
