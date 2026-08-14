import { DesktopIcon } from '@radix-ui/react-icons'
import type { CSSProperties } from 'react'
import type { AgentKind } from './model.ts'

const piAgentCells = [
  true, true, true, false,
  true, false, true, false,
  true, true, false, true,
  true, false, false, true,
]

export function AgentIcon({ kind }: { kind: AgentKind }) {
  if (kind === 'ssh') return <DesktopIcon className="agent-icon is-ssh" aria-hidden="true" />
  return <span className={`agent-icon is-${kind}`} aria-hidden="true">
    <img className="agent-icon-image" src={`/agent-icons/${kind}.svg`} alt="" />
    {kind === 'claude' && <img className="agent-icon-working" src="/agent-icons/claude-working.gif" alt="" />}
    {kind === 'pi' && <span className="pi-agent-matrix">
      {piAgentCells.map((enabled, index) => {
        const row = Math.floor(index / 4)
        const column = index % 4
        return <span
          key={`${row}-${column}`}
          className={`pi-agent-cell ${enabled ? 'is-lit' : ''}`}
          style={{ '--pi-cell-delay': `-${(row + column) * 92}ms` } as CSSProperties}
        />
      })}
    </span>}
  </span>
}
