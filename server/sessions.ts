import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { accessSync, constants, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import type { AgentActivity, AgentKind, TerminalBackend, TerminalSession } from '../src/model.ts'
import type { WorkspaceStore } from './store.ts'
import { agentActivityFromEvent, detectAgentKind, readProcesses, shouldPreserveAgentState, type ProcessInfo } from './agents.ts'
import { platformLabel, terminalBackendsForPlatform, type RuntimePlatform } from '../src/settings.ts'

export type MultiplexerPane = { runtimeName: string; paneId: string; pid: number }

export type MultiplexerAdapter = {
  backend: TerminalBackend
  exists(name: string): boolean
  list(): string[]
  create(name: string, cwd: string, command?: string[]): void
  stop(name: string): void
  currentWorkingDirectory?(name: string): string | undefined
  panes?(): MultiplexerPane[]
}

export type TmuxAdapter = Omit<MultiplexerAdapter, 'backend'> & { backend?: 'tmux' }
export type MultiplexerAdapters = Partial<Record<TerminalBackend, MultiplexerAdapter>>
export type AgentLocator = { backend: 'tmux'; paneId: string } | { backend: 'zellij'; runtimeName: string; paneId?: string }

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

export const realTmux: MultiplexerAdapter = {
  backend: 'tmux',
  exists(name) {
    return spawnSync(tmuxExecutable(), defaultTmuxArgs('has-session', '-t', name), { env: defaultTmuxEnv(), stdio: 'ignore' }).status === 0
  },
  list() {
    const result = spawnSync(tmuxExecutable(), defaultTmuxArgs('list-sessions', '-F', '#S'), { encoding: 'utf8', env: defaultTmuxEnv() })
    return result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean) : []
  },
  create(name, cwd, command) {
    const result = spawnSync(tmuxExecutable(), defaultTmuxArgs('new-session', '-d', '-s', name, '-c', cwd, ...(command ?? [])), { encoding: 'utf8', env: defaultTmuxEnv() })
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
    return result.stdout.trim().split('\n').filter(Boolean).flatMap((line) => {
      const [runtimeName, paneId, pid] = line.split('\t')
      return runtimeName && paneId && Number(pid) ? [{ runtimeName, paneId, pid: Number(pid) }] : []
    })
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
  create(name, cwd) {
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

  function agentInventory() {
    const processes = processReader()
    return new Map(Object.values(adapters).flatMap((adapter) => (adapter?.panes?.() ?? []).flatMap((pane) => {
      const kind = detectAgentKind(pane.pid, processes)
      return kind ? [[pane.runtimeName, kind] as const] : []
    })))
  }

  function agentFor(runtimeName: string, inventory: Map<string, AgentKind>): AgentActivity | undefined {
    const saved = store.getAgentActivity(runtimeName)
    const kind = inventory.get(runtimeName) ?? saved?.kind
    if (!kind) return
    return saved?.kind === kind ? saved : { kind, state: 'unavailable' }
  }

  function runtimeExists(session: TerminalSession) {
    return adapterFor(session.backend).exists(session.runtimeName)
  }

  function runtimeSnapshot() {
    return new Map(Object.values(adapters)
      .filter((adapter): adapter is MultiplexerAdapter => Boolean(adapter))
      .map((adapter) => [adapter.backend, new Set(adapter.list())]))
  }

  function runtimeExistsInSnapshot(session: TerminalSession, live: Map<TerminalBackend, Set<string>>) {
    return live.get(session.backend)?.has(session.runtimeName) === true
      || runtimePlatform === 'win32' && session.backend === 'zellij' && session.status !== 'stopped'
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

      if (!adapter.exists(names.runtimeName)) adapter.create(names.runtimeName, cwd)

      return store.upsertSession({
        id: existing?.id ?? `sess_${node.id}`,
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
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const cwd = safePath(requestedCwd ?? node.repoPath ?? allowedRoots[0], allowedRoots)
      const existing = store.getSessionByNode(nodeId)
      const backend = requestedBackend
      const adapter = adapterFor(backend)
      const label = node.jiraKey ?? node.title.toLowerCase().replace(/\s+/g, '-')
      const forbidden = existing ? new Set([existing.runtimeName]) : new Set<string>()
      const names = availableSessionNames(backend, node.workspaceId, label, node.id, adapter, forbidden)

      const existingAdapter = existing && existing.status !== 'stopped' ? adapterFor(existing.backend) : undefined
      if (existing && existing.status !== 'stopped' && existingAdapter?.exists(existing.runtimeName)) existingAdapter.stop(existing.runtimeName)
      if (!adapter.exists(names.runtimeName)) adapter.create(names.runtimeName, cwd)

      return store.upsertSession({
        id: existing?.id ?? `sess_${node.id}`,
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
        || runtimePlatform === 'win32' && session.backend === 'zellij' && session.status !== 'stopped'
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
      return store.updateSessionStatus(id, 'running')
    },

    detach(id: string) {
      return store.updateSessionStatus(id, 'detached')
    },

    stop(id: string) {
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const adapter = adapterFor(session.backend)
      if (adapter.exists(session.runtimeName) || runtimePlatform === 'win32' && session.backend === 'zellij') adapter.stop(session.runtimeName)
      return store.updateSessionStatus(id, 'stopped')
    },

    recoverCodex(id: string) {
      return this.recoverAgent(id, 'codex')
    },

    recoverAgent(id: string, requestedKind?: Exclude<AgentKind, 'ssh'>) {
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const activity = store.getAgentActivity(session.runtimeName)
      if (!activity || activity.kind === 'ssh') throw new Error('Agent session metadata is not available')
      if (requestedKind && activity.kind !== requestedKind) throw new Error(`${requestedKind} session metadata is not available`)
      const command = agentResumeCommand(activity)
      if (!command) throw new Error(`${activity.kind} session id is not available`)
      if (session.backend !== 'tmux') throw new Error('Agent recovery currently requires a tmux-backed session')
      const adapter = adapterFor(session.backend)
      if (!adapter.exists(session.runtimeName)) adapter.create(session.runtimeName, session.cwd, command)
      return store.upsertSession({
        ...session,
        status: 'running',
        lastAttachedAt: new Date().toISOString(),
      })
    },

    stopRuntime(backend: TerminalBackend, runtimeName: string) {
      if (!runtimeName.startsWith('muxmap')) throw new Error('Only muxmap sessions can be managed')
      const adapter = adapterFor(backend)
      if (adapter.exists(runtimeName) || runtimePlatform === 'win32' && backend === 'zellij') adapter.stop(runtimeName)
      const tracked = store.getSessionByRuntimeName(runtimeName)
      if (tracked?.backend === backend) store.updateSessionStatus(tracked.id, 'stopped')
    },

    runtimeSnapshot,

    decorate(items: TerminalSession[], inventory = agentInventory(), live = runtimeSnapshot()) {
      return items.map((session) => {
        const agent = agentFor(session.runtimeName, inventory)
        const exists = runtimeExistsInSnapshot(session, live)
        const agentEvents = store.listAgentEvents(session.runtimeName)
        return { ...session, ...(agent ? { agent } : {}), ...(agentEvents.length > 0 ? { agentEvents } : {}), runtimeExists: exists, canRecoverCodex: agent?.kind === 'codex' && canRecoverAgent(session, agent, exists), canRecoverAgent: canRecoverAgent(session, agent, exists) }
      })
    },

    listOrphans(inventory = agentInventory(), live = runtimeSnapshot()) {
      const tracked = new Set(store.listSessions().map((session) => `${session.backend}:${session.runtimeName}`))
      return Object.values(adapters).filter((adapter): adapter is MultiplexerAdapter => Boolean(adapter)).flatMap((adapter) => [...(live.get(adapter.backend) ?? [])]
        .filter((runtimeName) => runtimeName.startsWith('muxmap') && !tracked.has(`${adapter.backend}:${runtimeName}`))
        .map((runtimeName) => {
          const agent = agentFor(runtimeName, inventory)
          return agent ? { backend: adapter.backend, runtimeName, agent } : { backend: adapter.backend, runtimeName }
        }) ?? [])
        .sort((a, b) => a.runtimeName.localeCompare(b.runtimeName))
    },

    inventory() {
      return agentInventory()
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
      if (!activity || !['completed', 'delegated'].includes(activity.state)) return activity
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
      const adapter = adapterFor(backend)
      if (!runtimeName.startsWith('muxmap') || !adapter.exists(runtimeName)) throw new Error('MuxMap terminal session not found')
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

    reconcile(activeSessionIds = new Set<string>()) {
      const live = runtimeSnapshot()
      for (const session of store.listSessions()) {
        const running = live.get(session.backend)?.has(session.runtimeName)
        const status = running
          ? activeSessionIds.has(session.id) ? 'running' : 'detached'
          : runtimePlatform === 'win32' && session.backend === 'zellij' && session.status !== 'stopped' ? 'detached' : 'stopped'
        store.updateSessionStatus(session.id, status)
      }
      return live
    },
  }
}

export type SessionManager = ReturnType<typeof createSessionManager>
