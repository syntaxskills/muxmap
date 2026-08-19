import type { AgentActivity } from './model.ts'

export const agentNames: Record<AgentActivity['kind'], string> = { codex: 'Codex', claude: 'Claude Code', pi: 'Pi', ssh: 'SSH' }
const states: Record<AgentActivity['state'], string> = { unavailable: 'Status unavailable', working: 'Working', delegated: 'Working (background)', needs_input: 'Needs input', completed: 'Completed', read: 'Read' }

export function agentStatusText(agent: AgentActivity, now = Date.now()) {
  if (agent.kind === 'ssh') return 'SSH'
  const elapsed = agent.since ? Math.max(0, now - Date.parse(agent.since)) : 0
  const minutes = Math.floor(elapsed / 60_000)
  const duration = !agent.since || !['working', 'delegated', 'needs_input'].includes(agent.state) ? '' : minutes < 1 ? ' <1m' : minutes < 60 ? ` ${minutes}m` : ` ${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${agentNames[agent.kind]} · ${states[agent.state]}${duration}`
}
