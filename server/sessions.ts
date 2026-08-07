import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { AgentActivity, AgentKind, TerminalSession } from '../src/model.ts'
import type { WorkspaceStore } from './store.ts'
import { agentActivityFromEvent, detectAgentKind, readProcesses, type ProcessInfo } from './agents.ts'

export type TmuxPane = { tmuxName: string; paneId: string; pid: number }

export type TmuxAdapter = {
  exists(name: string): boolean
  list(): string[]
  create(name: string, cwd: string): void
  stop(name: string): void
  panes?(): TmuxPane[]
}

export function defaultTmuxEnv() {
  const env = { ...process.env }
  delete env.TMUX
  delete env.TMUX_PANE
  delete env.TMUX_TMPDIR
  return env
}

export const defaultTmuxArgs = (...args: string[]) => ['-L', 'default', ...args]

export const realTmux: TmuxAdapter = {
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
      const [tmuxName, paneId, pid] = line.split('\t')
      return tmuxName && paneId && Number(pid) ? [{ tmuxName, paneId, pid: Number(pid) }] : []
    })
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

function sessionNames(workspaceId: string, label: string) {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'shell'
  return {
    name: `tmux:${workspaceId}:${safeLabel}`,
    tmuxName: `muxmap-${workspaceId}-${safeLabel}`,
  }
}

export function createSessionManager(store: WorkspaceStore, tmux: TmuxAdapter, allowedRoots: string[], processReader: () => ProcessInfo[] = readProcesses) {
  function agentInventory() {
    const processes = processReader()
    return new Map((tmux.panes?.() ?? []).flatMap((pane) => {
      const kind = detectAgentKind(pane.pid, processes)
      return kind ? [[pane.tmuxName, kind] as const] : []
    }))
  }

  function agentFor(tmuxName: string, inventory: Map<string, AgentKind>): AgentActivity | undefined {
    const kind = inventory.get(tmuxName)
    if (!kind) return
    const saved = store.getAgentActivity(tmuxName)
    return saved?.kind === kind ? saved : { kind, state: 'unavailable' }
  }

  return {
    attach(nodeId: string, requestedCwd?: string): TerminalSession {
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const cwd = safePath(requestedCwd ?? node.repoPath ?? allowedRoots[0], allowedRoots)
      const label = node.jiraKey ?? node.title.toLowerCase().replace(/\s+/g, '-')
      const names = sessionNames(node.workspaceId, label)
      const existing = store.getSessionByNode(nodeId)

      if (!tmux.exists(names.tmuxName)) tmux.create(names.tmuxName, cwd)

      return store.upsertSession({
        id: existing?.id ?? `sess_${node.id}`,
        workspaceId: node.workspaceId,
        nodeId,
        ...names,
        backend: 'tmux',
        cwd,
        status: 'running',
        lastAttachedAt: new Date().toISOString(),
      })
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
      if (tmux.exists(session.tmuxName)) tmux.stop(session.tmuxName)
      return store.updateSessionStatus(id, 'stopped')
    },

    stopTmux(tmuxName: string) {
      if (!tmuxName.startsWith('muxmap')) throw new Error('Only muxmap tmux sessions can be managed')
      if (tmux.exists(tmuxName)) tmux.stop(tmuxName)
      const tracked = store.getSessionByTmuxName(tmuxName)
      if (tracked) store.updateSessionStatus(tracked.id, 'stopped')
    },

    decorate(items: TerminalSession[], inventory = agentInventory()) {
      return items.map((session) => {
        const agent = agentFor(session.tmuxName, inventory)
        return agent ? { ...session, agent } : session
      })
    },

    listOrphans(inventory = agentInventory()) {
      const tracked = new Set(store.listSessions().map((session) => session.tmuxName))
      return tmux.list()
        .filter((tmuxName) => tmuxName.startsWith('muxmap') && !tracked.has(tmuxName))
        .sort()
        .map((tmuxName) => {
          const agent = agentFor(tmuxName, inventory)
          return agent ? { tmuxName, agent } : { tmuxName }
        })
    },

    inventory() {
      return agentInventory()
    },

    recordAgentEvent(paneId: string, kind: Exclude<AgentKind, 'ssh'>, input: Record<string, unknown>, now?: string) {
      const pane = (tmux.panes?.() ?? []).find((item) => item.paneId === paneId)
      if (!pane?.tmuxName.startsWith('muxmap')) throw new Error('MuxMap tmux pane not found')
      return store.upsertAgentActivity(pane.tmuxName, agentActivityFromEvent(kind, input, now))
    },

    acknowledge(id: string) {
      const session = store.getSession(id)
      if (!session) throw new Error('Session not found')
      const activity = store.getAgentActivity(session.tmuxName)
      if (!activity || activity.state !== 'completed') return activity
      return store.upsertAgentActivity(session.tmuxName, { ...activity, state: 'read' })
    },

    adopt(nodeId: string, tmuxName: string) {
      if (!tmuxName.startsWith('muxmap') || !tmux.exists(tmuxName)) throw new Error('MuxMap tmux session not found')
      const node = store.getNode(nodeId)
      if (!node) throw new Error('Node not found')
      const existing = store.getSessionByNode(nodeId)
      if (existing && existing.status !== 'stopped') throw new Error('Node already has a terminal session')
      const cwd = safePath(node.repoPath ?? allowedRoots[0], allowedRoots)
      return store.upsertSession({
        id: existing?.id ?? `sess_${randomUUID()}`,
        workspaceId: node.workspaceId,
        nodeId,
        name: `tmux:${node.workspaceId}:${tmuxName.replace(/^muxmap-?/, '') || 'shell'}`,
        tmuxName,
        backend: 'tmux',
        cwd,
        status: 'detached',
        lastAttachedAt: new Date().toISOString(),
      })
    },

    reconcile(activeSessionIds = new Set<string>()) {
      const live = new Set(tmux.list())
      for (const session of store.listSessions()) {
        const status = live.has(session.tmuxName) ? activeSessionIds.has(session.id) ? 'running' : 'detached' : 'stopped'
        store.updateSessionStatus(session.id, status)
      }
    },
  }
}

export type SessionManager = ReturnType<typeof createSessionManager>
