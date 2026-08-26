import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { accessSync, constants, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import type { AgentActivity, AgentEventLogEntry, AgentEventSummary, AgentKind, TerminalBackend, TerminalSession } from '../src/model.ts'
import type { WorkspaceStore } from './store.ts'
import { agentActivityFromEvent, detectAgentKind, detectMuxMapHost, readProcesses, readProcessesAsync, shouldPreserveAgentState, type ProcessInfo } from './agents.ts'
import { platformLabel, terminalBackendsForPlatform, type RuntimePlatform } from '../src/settings.ts'

export type MultiplexerPane = { runtimeName: string; paneId: string; pid: number }

export type MultiplexerAdapter = {
  backend: TerminalBackend
  exists(name: string): boolean
  list(): string[]
  listAsync?(): Promise<string[]>
  create(name: string, cwd: string, command?: string[], sessionEnv?: Record<string, string>): void
  stop(name: string): void
  currentWorkingDirectory?(name: string): string | undefined
  panes?(): MultiplexerPane[]
  panesAsync?(): Promise<MultiplexerPane[]>
}

export type TmuxAdapter = Omit<MultiplexerAdapter, 'backend'> & { backend?: 'tmux' }
export type MultiplexerAdapters = Partial<Record<TerminalBackend, MultiplexerAdapter>>
export type AgentLocator = { backend: 'tmux'; paneId: string } | { backend: 'zellij'; runtimeName: string; paneId?: string }
export type RuntimeDiscoverySnapshot = {
  inventory: Map<string, AgentKind>
  selfHosting: Set<string>
  live: Map<TerminalBackend, Set<string>>
}

export function createShortTtlCache<T>(load: () => T, ttlMs: number, clock: () => number = () => Date.now()) {
  let cached: { value: T; expiresAt: number } | undefined
  return {
    get() {
      const now = clock()
      if (cached && now < cached.expiresAt) return cached.value
      const value = load()
      cached = { value, expiresAt: now + ttlMs }
      return value
    },
    peek() {
      return cached?.value
    },
    invalidate() {
      cached = undefined
    },
  }
}

export function createStaleWhileRevalidateCache<T>(load: () => Promise<T>, initialValue: T, ttlMs: number, clock: () => number = () => Date.now()) {
  let cached = { value: initialValue, expiresAt: 0 }
  let inFlight: Promise<T> | undefined

  const refresh = () => {
    if (inFlight) return inFlight
    inFlight = Promise.resolve()
      .then(load)
      .then((value) => {
        cached = { value, expiresAt: clock() + ttlMs }
        return value
      })
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }

  const triggerRefresh = () => {
    void refresh().catch(() => {
      // Keep serving the last completed snapshot if discovery fails.
    })
  }

  return {
    get() {
      if (clock() >= cached.expiresAt) triggerRefresh()
      return cached.value
    },
    peekFresh() {
      return clock() < cached.expiresAt ? cached.value : undefined
    },
    peek() {
      return cached.value
    },
    refresh,
    invalidate() {
      cached = { ...cached, expiresAt: 0 }
    },
    inFlight() {
      return inFlight
    },
  }
}

export function defaultTerminalBackend(platform: RuntimePlatform = process.platform): TerminalBackend {
  return platform === 'win32' ? 'zellij' : 'tmux'
}

export function defaultTmuxEnv() {
  const env = { ...process.env }
  delete env.TMUX
  delete env.TMUX_PANE
  delete env.TMUX_TMPDIR
  return env
}

function executableFromPath(binary: string, pathValue = process.env.PATH ?? '') {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, binary)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Keep searching PATH.
    }
  }
}

export function tmuxExecutable(platform = process.platform, env = process.env) {
  const configured = env.MUXMAP_TMUX_BIN?.trim()
  if (configured) return configured
  if (platform === 'win32') return 'tmux'
  return executableFromPath('tmux', env.PATH) ?? 'tmux'
}

export function defaultZellijEnv() {
  const env = { ...process.env }
  delete env.ZELLIJ
  delete env.ZELLIJ_SESSION_NAME
  delete env.ZELLIJ_PANE_ID
  return env
}

export const defaultTmuxArgs = (...args: string[]) => ['-L', 'default', ...args]

export function tmuxNewSessionArgs(name: string, cwd: string, command?: string[], sessionEnv: Record<string, string> = {}) {
  const envArgs = Object.entries(sessionEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  return defaultTmuxArgs('new-session', '-d', '-s', name, '-c', cwd, ...envArgs, ...(command ?? []))
}

function spawnText(command: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', () => resolve({ status: 1, stdout, stderr }))
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function parseTmuxPanes(output: string) {
  return output.trim().split('\n').filter(Boolean).flatMap((line) => {
    const [runtimeName, paneId, pid] = line.split('\t')
    return runtimeName && paneId && Number(pid) ? [{ runtimeName, paneId, pid: Number(pid) }] : []
  })
}

export const realTmux: MultiplexerAdapter = {
  backend: 'tmux',
  exists(name) {
    return spawnSync(tmuxExecutable(), defaultTmuxArgs('has-session', '-t', name), { env: defaultTmuxEnv(), stdio: 'ignore' }).status === 0
  },
  list() {
    const result = spawnSync(tmuxExecutable(), defaultTmuxArgs('list-sessions', '-F', '#S'), { encoding: 'utf8', env: defaultTmuxEnv() })
    return result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean) : []
  },
  async listAsync() {
    const result = await spawnText(tmuxExecutable(), defaultTmuxArgs('list-sessions', '-F', '#S'), { env: defaultTmuxEnv() })
    return result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean) : []
  },
  create(name, cwd, command, sessionEnv) {
    const result = spawnSync(tmuxExecutable(), tmuxNewSessionArgs(name, cwd, command, sessionEnv), { encoding: 'utf8', env: defaultTmuxEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to create tmux session')
  },
  stop(name) {
    const result = spawnSync(tmuxExecutable(), defaultTmuxArgs('kill-session', '-t', name), { encoding: 'utf8', env: defaultTmuxEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to stop tmux session')
  },
  currentWorkingDirectory(name) {
    const result = spawnSync(tmuxExecutable(), defaultTmuxArgs('display-message', '-p', '-t', name, '#{pane_current_path}'), { encoding: 'utf8', env: defaultTmuxEnv() })
    return result.status === 0 ? result.stdout.trim() || undefined : undefined
  },
  panes() {
    const result = spawnSync(tmuxExecutable(), defaultTmuxArgs('list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{pane_pid}'), { encoding: 'utf8', env: defaultTmuxEnv() })
    if (result.status !== 0) return []
    return parseTmuxPanes(result.stdout)
  },
  async panesAsync() {
    const result = await spawnText(tmuxExecutable(), defaultTmuxArgs('list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{pane_pid}'), { env: defaultTmuxEnv() })
    return result.status === 0 ? parseTmuxPanes(result.stdout) : []
  },
}

export function zellijExecutable(platform = process.platform) {
  return process.env.MUXMAP_ZELLIJ_BIN || (platform === 'win32' ? 'zellij.exe' : 'zellij')
}

const zellijConfig = fileURLToPath(new URL('./zellij.kdl', import.meta.url))
const zellijWindowsConfig = fileURLToPath(new URL('./zellij-windows.kdl', import.meta.url))

export function zellijConfigPath(platform = process.platform) {
  return platform === 'win32' ? zellijWindowsConfig : zellijConfig
}

export function parseZellijSessions(output: string) {
  return output.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
}

function windowsZellijSessions() {
  try {
    const root = process.env.ZELLIJ_SOCKET_DIR ?? join(tmpdir(), 'zellij')
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('contract_version_'))
      .flatMap((contract) => readdirSync(join(root, contract.name), { withFileTypes: true })
        .filter((entry) => {
          if (!entry.isFile()) return false
          try { process.kill(Number(readFileSync(join(root, contract.name, entry.name), 'utf8').trim()), 0); return true } catch { return false }
        })
        .map((entry) => entry.name))
  } catch {
    return []
  }
}

export const realZellij: MultiplexerAdapter = {
  backend: 'zellij',
  exists(name) {
    return this.list().includes(name)
  },
  list() {
    if (process.platform === 'win32') return windowsZellijSessions()
    const result = spawnSync(zellijExecutable(), ['list-sessions', '--short', '--no-formatting'], { encoding: 'utf8', env: defaultZellijEnv() })
    return result.status === 0 ? parseZellijSessions(result.stdout) : []
  },
  async listAsync() {
    if (process.platform === 'win32') return windowsZellijSessions()
    const result = await spawnText(zellijExecutable(), ['list-sessions', '--short', '--no-formatting'], { env: defaultZellijEnv() })
    return result.status === 0 ? parseZellijSessions(result.stdout) : []
  },
  create(name, cwd) {
    // Zellij has no portable per-session environment flag equivalent to tmux new-session -e.
    const args = process.platform === 'win32'
      ? ['--version']
      : ['--config', zellijConfigPath(), 'attach', '--create-background', name]
    const result = spawnSync(zellijExecutable(), args, { cwd, encoding: 'utf8', env: defaultZellijEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to create Zellij session. Install Zellij 0.44.3 or newer.')
    if (process.platform !== 'win32' && !this.exists(name)) throw new Error('Zellij reported success but the session did not start')
  },
  stop(name) {
    const result = spawnSync(zellijExecutable(), ['kill-session', name], { encoding: 'utf8', env: defaultZellijEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to stop Zellij session')
  },
}

function expandHome(path: string) {
  return path === '~' ? homedir() : path.startsWith(`~${sep}`) ? join(homedir(), path.slice(2)) : path
}

function safePath(path: string, roots: string[]) {
  const candidate = realpathSync(resolve(expandHome(path)))
  const allowed = roots.some((root) => {
    const resolvedRoot = realpathSync(isAbsolute(root) ? root : resolve(root))
    const child = relative(resolvedRoot, candidate)
    return child === '' || (!child.startsWith('..') && !isAbsolute(child))
  })
  if (!allowed) throw new Error('Terminal path is outside allowed repository roots')
  return candidate
}

function safeSessionLabel(label: string) {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'shell'
}

function sessionNames(backend: TerminalBackend, workspaceId: string, label: string) {
  const safeLabel = safeSessionLabel(label)
  return {
    name: `${backend}:${workspaceId}:${safeLabel}`,
    runtimeName: backend === 'tmux' ? `muxmap-${workspaceId}-${safeLabel}` : `muxmap-zellij-${workspaceId}-${safeLabel}`,
  }
}

export function agentResumeCommand(activity: AgentActivity) {
  if (activity.kind === 'codex' && activity.externalSessionId) return ['codex', 'resume', activity.externalSessionId]
  if (activity.kind === 'claude' && activity.externalSessionId) return ['claude', '--resume', activity.externalSessionId]
  if (activity.kind === 'pi') {
    const session = activity.externalSessionPath ?? activity.externalSessionId
    if (session) return ['pi', '--session', session]
  }
}

export function compactAgentEvents(events: AgentEventLogEntry[], limit = 5): AgentEventSummary[] {
  return events.slice(0, limit).map((event) => ({
    id: event.id,
    eventName: event.eventName,
    state: event.state,
    summary: event.summary ? event.summary.slice(0, 200) : undefined,
    createdAt: event.createdAt,
  }))
}

function nodeSuffix(nodeId: string) {
  return safeSessionLabel(nodeId).replace(/-/g, '').slice(0, 8) || 'node'
}

function normalizeAdapters(input: TmuxAdapter | MultiplexerAdapters): MultiplexerAdapters {
  if ('exists' in input) return { tmux: Object.assign(input, { backend: 'tmux' as const }) }
  return input
}

export function createSessionManager(
  store: WorkspaceStore,
  input: TmuxAdapter | MultiplexerAdapters,
  allowedRoots: string[],
  processReader: () => ProcessInfo[] = readProcesses,
  defaultBackend?: TerminalBackend,
  platform?: RuntimePlatform,
  options: { muxMapUrl?: string | (() => string); processReaderAsync?: () => Promise<ProcessInfo[]>; clock?: () => number } = {},
) {
  const runtimePlatform = platform ?? ('exists' in input ? 'linux' : process.platform)
  const adapters = normalizeAdapters(input)
  const selectedDefaultBackend = defaultBackend ?? ('exists' in input ? 'tmux' : defaultTerminalBackend(runtimePlatform))
  const adapterFor = (backend: TerminalBackend) => {
    if (!terminalBackendsForPlatform(runtimePlatform).includes(backend)) throw new Error(`${backend} is not available on ${platformLabel(runtimePlatform)}`)
    const adapter = adapters[backend]
    if (!adapter) throw new Error(`${backend === 'zellij' ? 'Zellij' : 'tmux'} terminal backend is unavailable`)
    return adapter
  }

  const emptyDiscoverySnapshot = (): RuntimeDiscoverySnapshot => ({ inventory: new Map(), selfHosting: new Set(), live: new Map() })
  const asyncDiscoveryAvailable = Boolean(options.processReaderAsync) || Object.values(adapters).some((adapter) => adapter?.listAsync || adapter?.panesAsync)
  const processReaderForDiscovery = options.processReaderAsync ?? (processReader === readProcesses ? readProcessesAsync : async () => processReader())

  function uncachedRuntimeSnapshot() {
    return new Map(Object.values(adapters)
      .filter((adapter): adapter is MultiplexerAdapter => Boolean(adapter))
      .map((adapter) => [adapter.backend, new Set(adapter.list())]))
  }

  async function uncachedRuntimeSnapshotAsync() {
    const entries = await Promise.all(Object.values(adapters)
      .filter((adapter): adapter is MultiplexerAdapter => Boolean(adapter))
      .map(async (adapter) => [adapter.backend, new Set(adapter.listAsync ? await adapter.listAsync() : adapter.list())] as const))
    return new Map(entries)
  }

  function buildRuntimeDiscoverySnapshot(): RuntimeDiscoverySnapshot {
    const processes = processReader()
    const panes = Object.values(adapters).flatMap((adapter) => adapter
      ? (adapter.panes?.() ?? []).map((pane) => ({ ...pane, backend: adapter.backend }))
      : [])
    const inventory = new Map(panes.flatMap((pane) => {
      const kind = detectAgentKind(pane.pid, processes)
      return kind ? [[pane.runtimeName, kind] as const] : []
    }))
    const selfHosting = new Set(panes
      .filter((pane) => pane.runtimeName.startsWith('muxmap') && detectMuxMapHost(pane.pid, processes))
      .map((pane) => `${pane.backend}:${pane.runtimeName}`))
    return { inventory, selfHosting, live: uncachedRuntimeSnapshot() }
  }

  async function buildRuntimeDiscoverySnapshotAsync(): Promise<RuntimeDiscoverySnapshot> {
    const processesPromise = processReaderForDiscovery()
    const panesPromise = Promise.all(Object.values(adapters).map(async (adapter) => adapter
      ? (adapter.panesAsync ? await adapter.panesAsync() : adapter.panes?.() ?? []).map((pane) => ({ ...pane, backend: adapter.backend }))
      : []))
    const livePromise = uncachedRuntimeSnapshotAsync()
    const [processes, panesByAdapter, live] = await Promise.all([processesPromise, panesPromise, livePromise])
    const panes = panesByAdapter.flat()
    const inventory = new Map(panes.flatMap((pane) => {
      const kind = detectAgentKind(pane.pid, processes)
      return kind ? [[pane.runtimeName, kind] as const] : []
    }))
    const selfHosting = new Set(panes
      .filter((pane) => pane.runtimeName.startsWith('muxmap') && detectMuxMapHost(pane.pid, processes))
      .map((pane) => `${pane.backend}:${pane.runtimeName}`))
    return { inventory, selfHosting, live }
  }

  const asyncRuntimeDiscovery = asyncDiscoveryAvailable
    ? createStaleWhileRevalidateCache(buildRuntimeDiscoverySnapshotAsync, emptyDiscoverySnapshot(), 2500, options.clock)
    : undefined
  const syncRuntimeDiscovery = asyncDiscoveryAvailable
    ? undefined
    : createShortTtlCache(buildRuntimeDiscoverySnapshot, 2500, options.clock)
  const invalidateRuntimeDiscovery = () => {
    asyncRuntimeDiscovery?.invalidate()
    syncRuntimeDiscovery?.invalidate()
  }

  function discoverySnapshot(): RuntimeDiscoverySnapshot {
    return asyncRuntimeDiscovery?.get() ?? syncRuntimeDiscovery!.get()
  }

  async function refreshRuntimeDiscovery(): Promise<RuntimeDiscoverySnapshot> {
    if (asyncRuntimeDiscovery) return asyncRuntimeDiscovery.refresh()
    syncRuntimeDiscovery!.invalidate()
    return syncRuntimeDiscovery!.get()
  }

  function agentInventory() {
    return discoverySnapshot().inventory
  }

  function selfHostingInventory() {
    return discoverySnapshot().selfHosting
  }

  function agentFor(runtimeName: string, inventory: Map<string, AgentKind>): AgentActivity | undefined {
    const saved = store.getAgentActivity(runtimeName)
    const kind = inventory.get(runtimeName) ?? saved?.kind
    if (!kind) return
    return saved?.kind === kind ? saved : { kind, state: 'unavailable' }
  }

  function assertNotSelfHosting(backend: TerminalBackend, runtimeName: string) {
    if (selfHostingInventory().has(`${backend}:${runtimeName}`)) throw new Error('This session is hosting MuxMap and cannot be managed here')
  }

  function runtimeExists(session: TerminalSession) {
    return adapterFor(session.backend).exists(session.runtimeName)
  }

  function runtimeSnapshot() {
    return discoverySnapshot().live
  }

  function runtimeExistsInSnapshot(session: TerminalSession, live: Map<TerminalBackend, Set<string>>) {
    return live.get(session.backend)?.has(session.runtimeName) === true
      || runtimePlatform === 'win32' && session.backend === 'zellij' && session.status !== 'stopped' && session.status !== 'suspended'
  }

  function runtimeExistsInCachedSnapshot(session: TerminalSession) {
    const snapshot = asyncRuntimeDiscovery?.peekFresh() ?? syncRuntimeDiscovery?.peek()
    return snapshot ? runtimeExistsInSnapshot(session, snapshot.live) : undefined
  }

  function canRecoverAgent(session: TerminalSession, agent: AgentActivity | undefined, exists: boolean) {
    return session.backend === 'tmux' && !exists && Boolean(agent && agent.kind !== 'ssh' && agentResumeCommand(agent))
  }

  function availableSessionNames(backend: TerminalBackend, workspaceId: string, label: string, nodeId: string, adapter: MultiplexerAdapter, forbiddenRuntimeNames = new Set<string>()) {
    const base = sessionNames(backend, workspaceId, label)
    const conflicts = (names: ReturnType<typeof sessionNames>) => {
      const tracked = store.getSessionByRuntimeName(names.runtimeName)
      return forbiddenRuntimeNames.has(names.runtimeName) || Boolean(tracked && tracked.nodeId !== nodeId) || adapter.exists(names.runtimeName)
    }
    if (!conflicts(base)) return base

    const suffix = nodeSuffix(nodeId)
    for (let index = 0; index < 100; index++) {
      const candidate = sessionNames(backend, workspaceId, index === 0 ? `${label}-${suffix}` : `${label}-${suffix}-${index + 1}`)
      if (!conflicts(candidate)) return candidate
    }
    throw new Error('Unable to allocate a unique terminal session name')
  }

  function contextEnv(nodeId: string, sessionId: string) {
    const muxMapUrl = typeof options.muxMapUrl === 'function' ? options.muxMapUrl() : options.muxMapUrl
    if (!muxMapUrl) return undefined
    return {
      MUXMAP_NODE_ID: nodeId,
      MUXMAP_SESSION_ID: sessionId,
      MUXMAP_URL: muxMapUrl,
    }
  }

  return {
    attach(nodeId: string, requestedCwd?: string, requestedBackend = selectedDefaultBackend): TerminalSession {
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const cwd = safePath(requestedCwd ?? node.repoPath ?? allowedRoots[0], allowedRoots)
      const existing = store.getSessionByNode(nodeId)
      const backend = existing?.backend ?? requestedBackend
      const adapter = adapterFor(backend)
      const label = node.jiraKey ?? node.title.toLowerCase().replace(/\s+/g, '-')
      const names = existing ?? availableSessionNames(backend, node.workspaceId, label, node.id, adapter)
      const sessionId = existing?.id ?? `sess_${node.id}`
      const cachedRuntimeExists = existing ? runtimeExistsInCachedSnapshot(existing) : undefined
      const shouldCreate = existing
        ? cachedRuntimeExists === false || (cachedRuntimeExists === undefined && ['stopped', 'suspended'].includes(existing.status))
        : !adapter.exists(names.runtimeName)

      if (shouldCreate) {
        adapter.create(names.runtimeName, cwd, undefined, backend === 'tmux' ? contextEnv(nodeId, sessionId) : undefined)
        invalidateRuntimeDiscovery()
      }

      return store.upsertSession({
        id: sessionId,
        workspaceId: node.workspaceId,
        nodeId,
        ...names,
        backend,
        cwd,
        status: 'running',
        lastAttachedAt: new Date().toISOString(),
      })
    },

    startNew(nodeId: string, requestedCwd?: string, requestedBackend = selectedDefaultBackend): TerminalSession {
      invalidateRuntimeDiscovery()
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const cwd = safePath(requestedCwd ?? node.repoPath ?? allowedRoots[0], allowedRoots)
      const existing = store.getSessionByNode(nodeId)
      const backend = requestedBackend
      const adapter = adapterFor(backend)
      const label = node.jiraKey ?? node.title.toLowerCase().replace(/\s+/g, '-')
      const forbidden = existing ? new Set([existing.runtimeName]) : new Set<string>()
      const names = availableSessionNames(backend, node.workspaceId, label, node.id, adapter, forbidden)
      const sessionId = existing?.id ?? `sess_${node.id}`

      const existingAdapter = existing && existing.status !== 'stopped' && existing.status !== 'suspended' ? adapterFor(existing.backend) : undefined
      if (existing && existing.status !== 'stopped' && existingAdapter?.exists(existing.runtimeName)) {
        existingAdapter.stop(existing.runtimeName)
        invalidateRuntimeDiscovery()
      }
      if (!adapter.exists(names.runtimeName)) {
        adapter.create(names.runtimeName, cwd, undefined, backend === 'tmux' ? contextEnv(nodeId, sessionId) : undefined)
        invalidateRuntimeDiscovery()
      }

      return store.upsertSession({
        id: sessionId,
        workspaceId: node.workspaceId,
        nodeId,
        ...names,
        backend,
        cwd,
        status: 'running',
        lastAttachedAt: new Date().toISOString(),
      })
    },

    exists(session: TerminalSession) {
      return runtimeExists(session)
        || runtimePlatform === 'win32' && session.backend === 'zellij' && session.status !== 'stopped' && session.status !== 'suspended'
    },

    canAttach(session: TerminalSession) {
      if (['stopped', 'suspended'].includes(session.status)) return false
      const cachedRuntimeExists = runtimeExistsInCachedSnapshot(session)
      return cachedRuntimeExists ?? true
    },

    currentWorkingDirectory(id: string) {
      const session = store.getSession(id)
      if (!session) return
      try {
        const adapter = adapterFor(session.backend)
        const cwd = adapter.currentWorkingDirectory?.(session.runtimeName)
        if (!cwd) return session.cwd
        return safePath(cwd, allowedRoots)
      } catch {
        return session.cwd
      }
    },

    markRunning(id: string) {
      invalidateRuntimeDiscovery()
      return store.updateSessionStatus(id, 'running')
    },

    detach(id: string) {
      invalidateRuntimeDiscovery()
      return store.updateSessionStatus(id, 'detached')
    },

    stop(id: string) {
      invalidateRuntimeDiscovery()
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      assertNotSelfHosting(session.backend, session.runtimeName)
      const adapter = adapterFor(session.backend)
      if (adapter.exists(session.runtimeName) || runtimePlatform === 'win32' && session.backend === 'zellij') {
        adapter.stop(session.runtimeName)
        invalidateRuntimeDiscovery()
      }
      return store.updateSessionStatus(id, 'stopped')
    },

    suspend(id: string) {
      invalidateRuntimeDiscovery()
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      assertNotSelfHosting(session.backend, session.runtimeName)
      const adapter = adapterFor(session.backend)
      if (adapter.exists(session.runtimeName) || runtimePlatform === 'win32' && session.backend === 'zellij') {
        adapter.stop(session.runtimeName)
        invalidateRuntimeDiscovery()
      }
      return store.updateSessionStatus(id, 'suspended')
    },

    recoverCodex(id: string) {
      return this.recoverAgent(id, 'codex')
    },

    recoverAgent(id: string, requestedKind?: Exclude<AgentKind, 'ssh'>) {
      invalidateRuntimeDiscovery()
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const activity = store.getAgentActivity(session.runtimeName)
      if (!activity || activity.kind === 'ssh') throw new Error('Agent session metadata is not available')
      if (requestedKind && activity.kind !== requestedKind) throw new Error(`${requestedKind} session metadata is not available`)
      const command = agentResumeCommand(activity)
      if (!command) throw new Error(`${activity.kind} session id is not available`)
      if (session.backend !== 'tmux') throw new Error('Agent recovery currently requires a tmux-backed session')
      const adapter = adapterFor(session.backend)
      if (!adapter.exists(session.runtimeName)) {
        adapter.create(session.runtimeName, session.cwd, command, contextEnv(session.nodeId, session.id))
        invalidateRuntimeDiscovery()
      }
      return store.upsertSession({
        ...session,
        status: 'running',
        lastAttachedAt: new Date().toISOString(),
      })
    },

    stopRuntime(backend: TerminalBackend, runtimeName: string) {
      invalidateRuntimeDiscovery()
      if (!runtimeName.startsWith('muxmap')) throw new Error('Only muxmap sessions can be managed')
      assertNotSelfHosting(backend, runtimeName)
      const adapter = adapterFor(backend)
      if (adapter.exists(runtimeName) || runtimePlatform === 'win32' && backend === 'zellij') {
        adapter.stop(runtimeName)
        invalidateRuntimeDiscovery()
      }
      const tracked = store.getSessionByRuntimeName(runtimeName)
      if (tracked?.backend === backend) store.updateSessionStatus(tracked.id, 'stopped')
    },

    runtimeSnapshot,

    decorate(items: TerminalSession[], inventory = agentInventory(), live = runtimeSnapshot()) {
      return items.map((session) => {
        const agent = agentFor(session.runtimeName, inventory)
        const exists = runtimeExistsInSnapshot(session, live)
        const agentEvents = compactAgentEvents(store.listAgentEvents(session.runtimeName, 5))
        const recoverableAgent = canRecoverAgent(session, agent, exists)
        return { ...session, ...(agent ? { agent } : {}), ...(agentEvents.length > 0 ? { agentEvents } : {}), runtimeExists: exists, canRecoverCodex: agent?.kind === 'codex' && recoverableAgent, canRecoverAgent: recoverableAgent, canBulkRecoverAgent: recoverableAgent && session.status !== 'stopped' && session.status !== 'suspended' }
      })
    },

    listOrphans(inventory = agentInventory(), live = runtimeSnapshot(), selfHosting = selfHostingInventory()) {
      const tracked = new Set(store.listSessions().map((session) => `${session.backend}:${session.runtimeName}`))
      return Object.values(adapters).filter((adapter): adapter is MultiplexerAdapter => Boolean(adapter)).flatMap((adapter) => [...(live.get(adapter.backend) ?? [])]
        .filter((runtimeName) => runtimeName.startsWith('muxmap') && !tracked.has(`${adapter.backend}:${runtimeName}`) && !selfHosting.has(`${adapter.backend}:${runtimeName}`))
        .map((runtimeName) => {
          const agent = agentFor(runtimeName, inventory)
          return agent ? { backend: adapter.backend, runtimeName, agent } : { backend: adapter.backend, runtimeName }
        }) ?? [])
        .sort((a, b) => a.runtimeName.localeCompare(b.runtimeName))
    },

    listSelfHosting(inventory = agentInventory(), live = runtimeSnapshot(), selfHosting = selfHostingInventory()) {
      return Object.values(adapters).filter((adapter): adapter is MultiplexerAdapter => Boolean(adapter)).flatMap((adapter) => [...(live.get(adapter.backend) ?? [])]
        .filter((runtimeName) => selfHosting.has(`${adapter.backend}:${runtimeName}`))
        .map((runtimeName) => {
          const agent = agentFor(runtimeName, inventory)
          return agent ? { backend: adapter.backend, runtimeName, role: 'self_hosting' as const, agent } : { backend: adapter.backend, runtimeName, role: 'self_hosting' as const }
        }) ?? [])
        .sort((a, b) => a.runtimeName.localeCompare(b.runtimeName))
    },

    inventory() {
      return agentInventory()
    },

    discoverySnapshot,

    refreshRuntimeDiscovery,

    invalidateRuntimeDiscovery,

    autoSuspend(maxActive: number, keepSessionId?: string) {
      const limit = Math.max(1, Math.floor(maxActive))
      const inventory = agentInventory()
      const live = runtimeSnapshot()
      const sessions = store.listSessions()
      const liveSessions = sessions.filter((session) => (
        session.status !== 'stopped'
        && session.status !== 'suspended'
        && runtimeExistsInSnapshot(session, live)
      ))
      const excess = liveSessions.length - limit
      if (excess <= 0) return []
      const protectedAgentStates = new Set<AgentActivity['state']>(['working', 'delegated', 'needs_input'])
      const candidates = liveSessions
        .filter((session) => session.id !== keepSessionId)
        .filter((session) => !protectedAgentStates.has(agentFor(session.runtimeName, inventory)?.state ?? 'read'))
        .sort((a, b) => (a.lastActivityAt ?? a.lastAttachedAt ?? a.updatedAt ?? a.createdAt).localeCompare(b.lastActivityAt ?? b.lastAttachedAt ?? b.updatedAt ?? b.createdAt))
        .slice(0, excess)
      return candidates.flatMap((session) => {
        const suspended = this.suspend(session.id)
        return suspended ? [suspended] : []
      })
    },

    recordAgentEvent(locator: AgentLocator, kind: Exclude<AgentKind, 'ssh'>, event: Record<string, unknown>, now = new Date().toISOString()) {
      const runtimeName = locator.backend === 'zellij'
        ? locator.runtimeName
        : adapters.tmux?.panes?.().find((item) => item.paneId === locator.paneId)?.runtimeName
      if (!runtimeName?.startsWith('muxmap') || !adapterFor(locator.backend).exists(runtimeName)) throw new Error('MuxMap terminal session not found')
      const activity = agentActivityFromEvent(kind, event, now)
      const current = store.getAgentActivity(runtimeName)
      if (!activity || shouldPreserveAgentState(current, event, activity)) {
        const preserved = current ?? { kind, state: 'unavailable' as const, since: now }
        store.recordAgentEvent(runtimeName, kind, event, preserved.state, now)
        return preserved
      }
      store.updateSessionActivityByRuntimeName(runtimeName, activity.since)
      store.recordAgentEvent(runtimeName, kind, event, activity.state, activity.since)
      return store.upsertAgentActivity(runtimeName, activity)
    },

    acknowledge(id: string) {
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const activity = store.getAgentActivity(session.runtimeName)
      if (!activity || activity.state !== 'completed') return activity
      const now = new Date().toISOString()
      const next = store.upsertAgentActivity(session.runtimeName, { ...activity, state: 'read' })
      if (next.kind !== 'ssh') store.recordAgentEvent(session.runtimeName, next.kind, { type: 'manual_status', state: 'read' }, next.state, now)
      return next
    },

    setAgentStatus(id: string, state: 'working' | 'delegated' | 'completed' | 'read', now = new Date().toISOString()) {
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const current = agentFor(session.runtimeName, agentInventory())
      if (!current || current.kind === 'ssh') throw new Error('Agent status is unavailable')
      const kind = current.kind
      const next = store.upsertAgentActivity(session.runtimeName, {
        ...current,
        kind,
        state,
        since: state === 'read' ? current.since : now,
      })
      store.recordAgentEvent(session.runtimeName, kind, { type: 'manual_status', state }, next.state, now)
      return next
    },

    adopt(nodeId: string, backend: TerminalBackend, runtimeName: string) {
      invalidateRuntimeDiscovery()
      const adapter = adapterFor(backend)
      if (!runtimeName.startsWith('muxmap') || !adapter.exists(runtimeName)) throw new Error('MuxMap terminal session not found')
      assertNotSelfHosting(backend, runtimeName)
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const existing = store.getSessionByNode(nodeId)
      if (existing && existing.status !== 'stopped') throw new Error('Node already has a terminal session')
      const cwd = safePath(node.repoPath ?? allowedRoots[0], allowedRoots)
      return store.upsertSession({
        id: existing?.id ?? `sess_${randomUUID()}`,
        workspaceId: node.workspaceId,
        nodeId,
        name: `${backend}:${node.workspaceId}:${runtimeName.replace(/^muxmap-(?:zellij-)?/, '') || 'shell'}`,
        runtimeName,
        backend,
        cwd,
        status: 'detached',
        lastAttachedAt: new Date().toISOString(),
      })
    },

    reconcile(activeSessionIds = new Set<string>(), live = runtimeSnapshot()) {
      const inventory = agentInventory()
      for (const session of store.listSessions()) {
        const running = live.get(session.backend)?.has(session.runtimeName)
        const recoverableMissing = !running
          && session.status !== 'stopped'
          && session.status !== 'suspended'
          && canRecoverAgent(session, agentFor(session.runtimeName, inventory), false)
        const status = running
          ? activeSessionIds.has(session.id) ? 'running' : 'detached'
          : recoverableMissing ? session.status
          : session.status === 'suspended' ? 'suspended'
            : runtimePlatform === 'win32' && session.backend === 'zellij' && session.status !== 'stopped' ? 'detached' : 'stopped'
        store.updateSessionStatus(session.id, status)
      }
      return live
    },
  }
}

export type SessionManager = ReturnType<typeof createSessionManager>
