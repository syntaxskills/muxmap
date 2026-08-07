import { DesktopIcon } from '@radix-ui/react-icons'
import type { AgentKind } from './model.ts'

export function AgentIcon({ kind }: { kind: AgentKind }) {
  if (kind === 'ssh') return <DesktopIcon className="agent-icon" aria-hidden="true" />
  return <img className={`agent-icon is-${kind}`} src={`/agent-icons/${kind}.svg`} alt="" />
}
