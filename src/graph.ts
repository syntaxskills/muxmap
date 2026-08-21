import type { WorkNode } from './model.ts'
import { agentNames } from './agentStatus.ts'

export type ReorderPosition = 'before' | 'after'

export type ArchivedNodeEntry = {
  node: WorkNode
  depth: number
  path: string
  inherited: boolean
}

export function effectiveArchivedNodeIds(nodes: WorkNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const archived = new Set<string>()

  for (const node of nodes) {
    let current: WorkNode | undefined = node
    while (current) {
      if (current.archivedAt) {
        archived.add(node.id)
        break
      }
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return archived
}

export function activeNodes(nodes: WorkNode[]) {
  const archived = effectiveArchivedNodeIds(nodes)
  return nodes.filter((node) => !archived.has(node.id))
}

export function archivedDirectChildren(nodes: WorkNode[], parentId: string) {
  const archived = effectiveArchivedNodeIds(nodes)
  return nodes
    .filter((node) => node.parentId === parentId && archived.has(node.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
}

export function archivedNodeEntries(nodes: WorkNode[], query: string): ArchivedNodeEntry[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const archived = effectiveArchivedNodeIds(nodes)
  const children = new Map<string, WorkNode[]>()
  for (const node of nodes) {
    if (!node.parentId || !archived.has(node.id)) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
  }

  const roots = nodes.filter((node) => archived.has(node.id) && (!node.parentId || !archived.has(node.parentId)))
  const entries: ArchivedNodeEntry[] = []
  const visit = (node: WorkNode, depth: number) => {
    const path: string[] = []
    let current: WorkNode | undefined = node
    while (current?.parentId) {
      path.unshift(current.title)
      current = byId.get(current.parentId)
    }
    entries.push({ node, depth, path: path.join(' / '), inherited: Boolean(node.parentId && archived.has(node.parentId)) })
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)

  const needle = query.trim().toLowerCase()
  if (!needle) return entries
  const included = new Set<string>()
  for (const entry of entries) {
    const searchable = `${entry.node.title} ${entry.node.jiraKey ?? ''} ${entry.node.project ?? ''} ${entry.node.note ?? ''} ${entry.path}`.toLowerCase()
    if (!searchable.includes(needle)) continue
    let current: WorkNode | undefined = entry.node
    while (current && archived.has(current.id)) {
      included.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return entries.filter((entry) => included.has(entry.node.id))
}

function wrappedLineCount(value: unknown, charsPerLine: number) {
  if (typeof value !== 'string' || !value.trim()) return 0
  return Math.max(1, Math.ceil(value.trim().length / charsPerLine))
}

export function expandedNodeHeight(node: WorkNode, hasAgent: boolean, archivedChildCount = 0, hasActivity = false) {
  const valueCharsPerLine = 28
  const rows = [
    node.project ? 1 : 0,
    node.jiraKey ? 1 : 0,
    node.repoPath ? 1 : 0,
    Math.min(wrappedLineCount(node.note, valueCharsPerLine), 2),
    hasAgent ? 1 : 0,
    archivedChildCount > 0 ? 1 : 0,
    hasActivity ? 1 : 0,
    1,
  ].reduce((sum, row) => sum + row, 0)
  return Math.max(106, 64 + rows * 13)
}

export function reorderSiblings(nodes: WorkNode[], movedId: string, targetId: string, position: ReorderPosition) {
  const moved = nodes.find((node) => node.id === movedId)
  const target = nodes.find((node) => node.id === targetId)
  if (!moved || !target || moved.id === target.id || !moved.parentId || moved.parentId !== target.parentId) return nodes

  const siblings = nodes
    .filter((node) => node.parentId === moved.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt))
    .filter((node) => node.id !== moved.id)
  const targetIndex = siblings.findIndex((node) => node.id === target.id)
  siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved)
  const orders = new Map(siblings.map((node, index) => [node.id, index]))
  return nodes.map((node) => orders.has(node.id) ? { ...node, sortOrder: orders.get(node.id)! } : node)
}

export function liveSessionIdForNode(sessions: Array<{ id: string; nodeId: string; status: string; runtimeExists?: boolean }>, nodeId: string) {
  return sessions.find((session) => nodeHasLiveSession(session) && session.nodeId === nodeId)?.id ?? null
}

export function openableSessionIdForNode(sessions: Array<{ id: string; nodeId: string; status: string; runtimeExists?: boolean }>, nodeId: string) {
  return sessions.find((session) => nodeCanOpenTerminal(session) && session.nodeId === nodeId)?.id ?? null
}

type RecoverableSession = {
  backend: string
  status: string
  runtimeExists?: boolean
  agent?: { kind: string; externalSessionId?: string; externalSessionPath?: string }
}

export function canRecoverAgentSession(session: RecoverableSession) {
  const runtimeMissing = session.runtimeExists === false || session.status === 'stopped'
  if (session.backend !== 'tmux' || !runtimeMissing || !session.agent) return false
  if (session.agent.kind === 'codex' || session.agent.kind === 'claude') return Boolean(session.agent.externalSessionId)
  if (session.agent.kind === 'pi') return Boolean(session.agent.externalSessionPath || session.agent.externalSessionId)
  return false
}

export function canRecoverCodexSession(session: RecoverableSession) {
  return session.agent?.kind === 'codex' && canRecoverAgentSession(session)
}

export function recoverableAgentLabel(session: RecoverableSession) {
  const kind = session.agent?.kind
  return kind && kind in agentNames ? agentNames[kind as keyof typeof agentNames] : 'Agent'
}

export function visibleAgentForSession<T extends { status: string; runtimeExists?: boolean; agent?: unknown }>(session: T | undefined): T['agent'] | undefined {
  if (!session || !nodeHasLiveSession(session)) return undefined
  return session.agent
}

export function branchHasLiveSession(nodes: WorkNode[], sessions: Array<{ nodeId: string; status: string; runtimeExists?: boolean }>, nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return sessions.some((session) => {
    if (!nodeHasLiveSession(session)) return false
    let currentId: string | null = session.nodeId
    while (currentId) {
      if (currentId === nodeId) return true
      currentId = byId.get(currentId)?.parentId ?? null
    }
    return false
  })
}

export function nodeHasLiveSession(session: { status: string; runtimeExists?: boolean }) {
  return session.status !== 'stopped' && session.status !== 'suspended' && session.runtimeExists !== false
}

export function nodeCanOpenTerminal(session: { status: string; runtimeExists?: boolean }) {
  return nodeHasLiveSession(session) || session.status === 'suspended'
}

export function visibleNodes(nodes: WorkNode[], collapsed: Set<string>, query: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const needle = query.trim().toLowerCase()

  if (needle) {
    const included = new Set<string>()
    for (const node of nodes) {
      if (`${node.title} ${node.jiraKey ?? ''} ${node.project ?? ''}`.toLowerCase().includes(needle)) {
        let current: WorkNode | undefined = node
        while (current) {
          included.add(current.id)
          current = current.parentId ? byId.get(current.parentId) : undefined
        }
      }
    }
    return nodes.filter((node) => included.has(node.id))
  }

  const hiddenByCollapse = new Set<string>()

  for (const node of nodes) {
    let parentId = node.parentId
    while (parentId) {
      if (collapsed.has(parentId)) hiddenByCollapse.add(node.id)
      parentId = byId.get(parentId)?.parentId ?? null
    }
  }

  return nodes.filter((node) => !hiddenByCollapse.has(node.id))
}
