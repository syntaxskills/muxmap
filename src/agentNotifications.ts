import { agentNames } from './agentStatus.ts'
import type { WorkspaceGraph } from './model.ts'

export type AgentNotification = {
  key: string
  sessionId: string
  nodeId: string
  title: string
  body: string
}

export function scanAgentNotifications(graph: WorkspaceGraph, previous: ReadonlyMap<string, string>, emit = true) {
  const notified = new Map(previous)
  const notifications: AgentNotification[] = []
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))

  for (const session of graph.sessions) {
    const agent = session.agent
    if (!agent || !['completed', 'needs_input'].includes(agent.state)) continue
    const key = `${agent.state}:${agent.since ?? ''}`
    if (notified.get(session.id) === key) continue
    notified.set(session.id, key)
    const node = nodes.get(session.nodeId)
    if (emit && node) notifications.push({
      key,
      sessionId: session.id,
      nodeId: node.id,
      title: `${agentNames[agent.kind]} ${agent.state === 'completed' ? 'completed' : 'needs input'}`,
      body: node.title,
    })
  }

  return { notifications, notified }
}
