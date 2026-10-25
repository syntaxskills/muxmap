import { useState } from 'react'
import { CopyIcon } from '@radix-ui/react-icons'
import { agentStatusText } from './agentStatus.ts'
import { agentSessionDetails } from './agentSessionDetails.ts'
import { copyText } from './clipboard.ts'
import type { TerminalSession } from './model.ts'

type Props = {
  session: TerminalSession
  statusLabel?: string
  className?: string
}

export function SessionBindingCard({ session, statusLabel, className = 'agent-session-card' }: Props) {
  const [copied, setCopied] = useState('')
  const status = statusLabel ?? (session.agent ? agentStatusText(session.agent) : session.status)

  return (
    <section className={className} aria-label="Agent and terminal session identifiers">
      <header><span>Session binding</span><small>{status}</small></header>
      <dl>
        {agentSessionDetails(session).map((row) => (
          <div key={row.label} className="session-binding-row">
            <dt>{row.label}</dt>
            <dd title={row.title ?? row.value}>
              <code className="session-binding-value">{row.value}</code>
              <button
                type="button"
                className="session-binding-copy"
                aria-label={`Copy ${row.label}`}
                title={`Copy ${row.label}`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void copyText(row.value).then(() => {
                    setCopied(row.label)
                    window.setTimeout(() => setCopied((current) => current === row.label ? '' : current), 1200)
                  })
                }}
              >
                <CopyIcon />
                <span>{copied === row.label ? 'Copied' : 'Copy'}</span>
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
