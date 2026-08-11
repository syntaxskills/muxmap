import type { WorkNode } from './model.ts'

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

export function expandedNodeHeight(node: WorkNode, hasAgent: boolean, archivedChildCount = 0, hasActivity = false) {
  const rows = 1 + [node.project, node.jiraKey, node.repoPath, node.note].filter(Boolean).length + Number(hasAgent) + Number(archivedChildCount > 0) + Number(hasActivity)
  return Math.max(106, 64 + rows * 12)
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
  return sessions.find((session) => session.nodeId === nodeId && session.status !== 'stopped' && session.runtimeExists !== false)?.id ?? null
}

export function canRecoverCodexSession(session: {
  backend: string
  status: string
  runtimeExists?: boolean
  agent?: { kind: string; externalSessionId?: string }
}) {
  const runtimeMissing = session.runtimeExists === false || session.status === 'stopped'
  return session.backend === 'tmux' && runtimeMissing && session.agent?.kind === 'codex' && Boolean(session.agent.externalSessionId)
}

export function visibleAgentForSession<T extends { status: string; runtimeExists?: boolean; agent?: unknown }>(session: T | undefined): T['agent'] | undefined {
  if (!session || session.status === 'stopped' || session.runtimeExists === false) return undefined
  return session.agent
}

export function branchHasLiveSession(nodes: WorkNode[], sessions: Array<{ nodeId: string; status: string; runtimeExists?: boolean }>, nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return sessions.some((session) => {
    if (session.status === 'stopped' || session.runtimeExists === false) return false
    let currentId: string | null = session.nodeId
    while (currentId) {
      if (currentId === nodeId) return true
      currentId = byId.get(currentId)?.parentId ?? null
    }
    return false
  })
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
