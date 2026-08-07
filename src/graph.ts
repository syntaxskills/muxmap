import type { WorkNode } from './model.ts'

export type ReorderPosition = 'before' | 'after'

export function expandedNodeHeight(node: WorkNode, hasAgent: boolean) {
  const rows = 1 + [node.project, node.jiraKey, node.repoPath, node.note].filter(Boolean).length + Number(hasAgent)
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

export function liveSessionIdForNode(sessions: Array<{ id: string; nodeId: string; status: string }>, nodeId: string) {
  return sessions.find((session) => session.nodeId === nodeId && session.status !== 'stopped')?.id ?? null
}

export function branchHasLiveSession(nodes: WorkNode[], sessions: Array<{ nodeId: string; status: string }>, nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return sessions.some((session) => {
    if (session.status === 'stopped') return false
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
