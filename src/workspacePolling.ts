import type { TerminalSession, WorkNode, WorkspaceGraph } from './model.ts'

export function withAttachedSession(graph: WorkspaceGraph, session: TerminalSession, node?: WorkNode): WorkspaceGraph {
  return {
    ...graph,
    nodes: node && !graph.nodes.some((item) => item.id === node.id) ? [...graph.nodes, node] : graph.nodes,
    sessions: [...graph.sessions.filter((item) => item.nodeId !== session.nodeId && item.id !== session.id), session],
    orphans: graph.orphans?.filter((item) => item.backend !== session.backend || item.runtimeName !== session.runtimeName),
  }
}

export function parseWorkspacePayloadIfChanged<T>(previousText: string | null, nextText: string) {
  if (previousText === nextText) return { changed: false as const }
  return { changed: true as const, graph: JSON.parse(nextText) as T }
}
