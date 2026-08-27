import type { AgentActivity } from './model.ts'

export const STALE_BACKGROUND_MS = 2 * 60 * 60 * 1000

export function isStaleBackgroundAgent(agent: Pick<AgentActivity, 'state' | 'since'> | undefined, now = Date.now()) {
  if (!agent || (agent.state !== 'delegated' && agent.state !== 'standby')) return false
  const since = agent.since ? Date.parse(agent.since) : Number.NaN
  return Number.isFinite(since) && now - since > STALE_BACKGROUND_MS
}

export function canAcknowledgeAgentOnOpen(agent: Pick<AgentActivity, 'state' | 'since'> | undefined, now = Date.now()) {
  return Boolean(agent && (agent.state === 'completed' || agent.state === 'standby' || (agent.state === 'delegated' && isStaleBackgroundAgent(agent, now))))
}
