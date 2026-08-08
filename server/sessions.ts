import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import type { AgentActivity, AgentKind, TerminalBackend, TerminalSession } from '../src/model.ts'
import type { WorkspaceStore } from './store.ts'
import { agentActivityFromEvent, detectAgentKind, readProcesses, type ProcessInfo } from './agents.ts'

export type MultiplexerPane = { runtimeName: string; paneId: string; pid: number }

export type MultiplexerAdapter = {
  backend: TerminalBackend
  exists(name: string): boolean
  list(): string[]
  create(name: string, cwd: string): void
  stop(name: string): void
  panes?(): MultiplexerPane[]
}

export type TmuxAdapter = Omit<MultiplexerAdapter, 'backend'> & { backend?: 'tmux' }
export type MultiplexerAdapters = Partial<Record<TerminalBackend, MultiplexerAdapter>>
export type AgentLocator = { backend: 'tmux'; paneId: string } | { backend: 'zellij'; runtimeName: string; paneId?: string }

export function defaultTerminalBackend(platform = process.platform): TerminalBackend {
  return platform === 'win32' ? 'zellij' : 'tmux'
}

export function defaultTmuxEnv() {
  const env = { ...process.env }
  delete env.TMUX
  delete env.TMUX_PANE
  delete env.TMUX_TMPDIR
  return env
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
    return spawnSync('tmux', defaultTmuxArgs('has-session', '-t', name), { env: defaultTmuxEnv(), stdio: 'ignore' }).status === 0
  },
  list() {
    const result = spawnSync('tmux', defaultTmuxArgs('list-sessions', '-F', '#S'), { encoding: 'utf8', env: defaultTmuxEnv() })
    return result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean) : []
  },
  create(name, cwd) {
    const result = spawnSync('tmux', defaultTmuxArgs('new-session', '-d', '-s', name, '-c', cwd), { encoding: 'utf8', env: defaultTmuxEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to create tmux session')
  },
  stop(name) {
    const result = spawnSync('tmux', defaultTmuxArgs('kill-session', '-t', name), { encoding: 'utf8', env: defaultTmuxEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to stop tmux session')
  },
  panes() {
    const result = spawnSync('tmux', defaultTmuxArgs('list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{pane_pid}'), { encoding: 'utf8', env: defaultTmuxEnv() })
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

export function parseZellijSessions(output: string) {
  return output.split(/\r?\n/).map((name) => name.trim()).filter(Boolean)
}

function windowsZellijSessions() {
  try {
    const processes = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout
    const livePids = new Set([...processes.matchAll(/^"[^"]+","(\d+)"/gm)].map((match) => match[1]))
    const root = process.env.ZELLIJ_SOCKET_DIR ?? join(tmpdir(), 'zellij')
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('contract_version_'))
      .flatMap((contract) => readdirSync(join(root, contract.name), { withFileTypes: true })
        .filter((entry) => entry.isFile() && livePids.has(readFileSync(join(root, contract.name, entry.name), 'utf8').trim()))
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
    const config = process.platform === 'win32' ? zellijWindowsConfig : zellijConfig
    const result = spawnSync(zellijExecutable(), ['--config', config, 'attach', '--create-background', name], { cwd, encoding: 'utf8', env: defaultZellijEnv() })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'Unable to create Zellij session. Install Zellij 0.44.3 or newer.')
    if (process.platform === 'win32') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
    if (!this.exists(name)) throw new Error('Zellij reported success but the session did not start')
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

function sessionNames(backend: TerminalBackend, workspaceId: string, label: string) {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'shell'
  return {
    name: `${backend}:${workspaceId}:${safeLabel}`,
    runtimeName: backend === 'tmux' ? `muxmap-${workspaceId}-${safeLabel}` : `muxmap-zellij-${workspaceId}-${safeLabel}`,
  }
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
) {
  const adapters = normalizeAdapters(input)
  const selectedDefaultBackend = defaultBackend ?? ('exists' in input ? 'tmux' : defaultTerminalBackend())
  const adapterFor = (backend: TerminalBackend) => {
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

  return {
    attach(nodeId: string, requestedCwd?: string, requestedBackend = selectedDefaultBackend): TerminalSession {
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const cwd = safePath(requestedCwd ?? node.repoPath ?? allowedRoots[0], allowedRoots)
      const existing = store.getSessionByNode(nodeId)
      const backend = existing?.backend ?? requestedBackend
      const adapter = adapterFor(backend)
      const label = node.jiraKey ?? node.title.toLowerCase().replace(/\s+/g, '-')
      const names = sessionNames(backend, node.workspaceId, label)

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
      return adapterFor(session.backend).exists(session.runtimeName)
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
      if (adapter.exists(session.runtimeName)) adapter.stop(session.runtimeName)
      return store.updateSessionStatus(id, 'stopped')
    },

    stopRuntime(backend: TerminalBackend, runtimeName: string) {
      if (!runtimeName.startsWith('muxmap')) throw new Error('Only muxmap sessions can be managed')
      const adapter = adapterFor(backend)
      if (adapter.exists(runtimeName)) adapter.stop(runtimeName)
      const tracked = store.getSessionByRuntimeName(runtimeName)
      if (tracked?.backend === backend) store.updateSessionStatus(tracked.id, 'stopped')
    },

    decorate(items: TerminalSession[], inventory = agentInventory()) {
      return items.map((session) => {
        const agent = agentFor(session.runtimeName, inventory)
        return agent ? { ...session, agent } : session
      })
    },

    listOrphans(inventory = agentInventory()) {
      const tracked = new Set(store.listSessions().map((session) => `${session.backend}:${session.runtimeName}`))
      return Object.values(adapters).flatMap((adapter) => adapter?.list()
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

    recordAgentEvent(locator: AgentLocator, kind: Exclude<AgentKind, 'ssh'>, event: Record<string, unknown>, now?: string) {
      const runtimeName = locator.backend === 'zellij'
        ? locator.runtimeName
        : adapters.tmux?.panes?.().find((item) => item.paneId === locator.paneId)?.runtimeName
      if (!runtimeName?.startsWith('muxmap') || !adapterFor(locator.backend).exists(runtimeName)) throw new Error('MuxMap terminal session not found')
      return store.upsertAgentActivity(runtimeName, agentActivityFromEvent(kind, event, now))
    },

    acknowledge(id: string) {
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const activity = store.getAgentActivity(session.runtimeName)
      if (!activity || activity.state !== 'completed') return activity
      return store.upsertAgentActivity(session.runtimeName, { ...activity, state: 'read' })
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
      const live = new Map(Object.values(adapters).map((adapter) => [adapter!.backend, new Set(adapter!.list())]))
      for (const session of store.listSessions()) {
        const status = live.get(session.backend)?.has(session.runtimeName) ? activeSessionIds.has(session.id) ? 'running' : 'detached' : 'stopped'
        store.updateSessionStatus(session.id, status)
      }
    },
  }
}

export type SessionManager = ReturnType<typeof createSessionManager>
