import { agentNames, agentStatusText } from './agentStatus.ts'
import type { TerminalSession } from './model.ts'

export type AgentSessionDetail = {
  label: string
  value: string
  title?: string
}

export function shortSessionId(value: string, prefixLength = 8, suffixLength = 4) {
  const trimmed = value.trim()
  if (trimmed.length <= prefixLength + suffixLength + 1) return trimmed
  return `${trimmed.slice(0, prefixLength)}…${trimmed.slice(-suffixLength)}`
}

export function agentSessionSummary(session: TerminalSession) {
  const agent = session.agent
  if (agent?.externalSessionId) return `${agentNames[agent.kind]} ${shortSessionId(agent.externalSessionId)}`
  if (agent?.externalSessionPath) return `${agentNames[agent.kind]} session file`
  if (agent) return agentStatusText(agent)
  return `${session.backend} ${session.runtimeName}`
}

export function agentSessionDetails(session: TerminalSession): AgentSessionDetail[] {
  const agent = session.agent
  const rows: AgentSessionDetail[] = []
  if (agent?.externalSessionId) rows.push({ label: `${agentNames[agent.kind]} session`, value: agent.externalSessionId })
  if (agent?.externalSessionPath) rows.push({ label: 'Session file', value: agent.externalSessionPath })
  if (agent?.externalCwd) rows.push({ label: 'Agent cwd', value: agent.externalCwd })
  rows.push(
    { label: 'MuxMap session', value: session.id },
    { label: 'Runtime', value: `${session.backend}:${session.runtimeName}` },
    { label: 'Terminal cwd', value: session.cwd },
  )
  return rows
}
