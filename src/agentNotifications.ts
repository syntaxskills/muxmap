import { agentNames } from './agentStatus.ts'
import type { WorkspaceGraph } from './model.ts'
import { notificationDeliveryTargets, type AppSettings } from './settings.ts'

export const IN_PAGE_NOTIFICATION_LIFETIME_MS = 8_000

export type AgentNotification = {
  key: string
  sessionId: string
  nodeId: string
  title: string
  body: string
}

export function mergeAgentNotifications(current: AgentNotification[], incoming: AgentNotification[]) {
  const merged = new Map(current.map((item) => [item.sessionId, item]))
  for (const item of incoming) merged.set(item.sessionId, item)
  return [...merged.values()]
}

export function routeAgentNotifications(notifications: AgentNotification[], delivery: AppSettings['notifications.delivery'], completed: boolean, needsInput: boolean) {
  const enabled = notifications.filter((event) => event.key.startsWith('needs_input:') ? needsInput : completed)
  const targets = notificationDeliveryTargets(delivery)
  return {
    system: targets.system ? enabled : [],
    inPage: targets.inPage ? enabled : [],
  }
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
