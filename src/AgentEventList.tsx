import type { AgentEventLogEntry } from './model.ts'

type Props = {
  events?: AgentEventLogEntry[]
}

function eventTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventMeta(event: AgentEventLogEntry) {
  return [
    event.notificationType ? `notification:${event.notificationType}` : '',
    event.agentType ? `agent:${event.agentType}` : '',
    event.agentId ? `id:${event.agentId}` : '',
  ].filter(Boolean).join(' · ')
}

export function AgentEventList({ events = [] }: Props) {
  return (
    <details className="agent-event-list" open>
      <summary><span>Agent event log</span><small>{events.length ? `${events.length} recent` : 'No hooks yet'}</small></summary>
      {events.length === 0 ? <p>No hook events have been received for this terminal yet.</p> : (
        <ol>
          {events.map((event) => (
            <li className={`is-${event.state}`} key={event.id}>
              <time dateTime={event.createdAt}>{eventTime(event.createdAt)}</time>
              <div>
                <strong>{event.eventName}</strong>
                <span>{event.kind} · {event.state}</span>
                {eventMeta(event) && <small>{eventMeta(event)}</small>}
                {event.summary && <em>{event.summary}</em>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}
