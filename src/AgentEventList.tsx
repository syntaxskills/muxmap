import { useEffect, useState } from 'react'
import { api } from './api.ts'
import type { AgentEventLogEntry, AgentEventSummary } from './model.ts'

type Props = {
  events?: Array<AgentEventLogEntry | AgentEventSummary>
  sessionId?: string
}

function eventTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function eventMeta(event: AgentEventLogEntry | AgentEventSummary) {
  if (!('kind' in event)) return ''
  return [
    event.notificationType ? `notification:${event.notificationType}` : '',
    event.agentType ? `agent:${event.agentType}` : '',
    event.agentId ? `id:${event.agentId}` : '',
  ].filter(Boolean).join(' · ')
}

export function AgentEventList({ events = [], sessionId }: Props) {
  const [loadedEvents, setLoadedEvents] = useState<Array<AgentEventLogEntry | AgentEventSummary> | null>(null)
  useEffect(() => {
    if (!sessionId) {
      setLoadedEvents(null)
      return
    }
    let disposed = false
    setLoadedEvents(null)
    void api<{ events: AgentEventLogEntry[] }>(`/api/sessions/${sessionId}/agent-events`)
      .then((response) => { if (!disposed) setLoadedEvents(response.events) })
      .catch(() => { if (!disposed) setLoadedEvents(null) })
    return () => { disposed = true }
  }, [sessionId])
  const visibleEvents = loadedEvents ?? events
  return (
    <details className="agent-event-list" open>
      <summary><span>Agent event log</span><small>{visibleEvents.length ? `${visibleEvents.length} recent` : 'No hooks yet'}</small></summary>
      {visibleEvents.length === 0 ? <p>No hook events have been received for this terminal yet.</p> : (
        <ol>
          {visibleEvents.map((event) => (
            <li className={`is-${event.state}`} key={event.id}>
              <time dateTime={event.createdAt}>{eventTime(event.createdAt)}</time>
              <div>
                <strong>{event.eventName}</strong>
                <span>{'kind' in event ? event.kind : 'agent'} · {event.state}</span>
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
