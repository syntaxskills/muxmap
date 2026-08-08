import { type CSSProperties, useMemo, useState } from 'react'
import { ArchiveIcon, Cross2Icon, MagnifyingGlassIcon, ReloadIcon } from '@radix-ui/react-icons'
import { archivedNodeEntries } from './graph.ts'
import type { NodeType, TerminalSession, WorkNode } from './model.ts'

const typeLabels: Record<NodeType, string> = {
  workspace: 'Workspace',
  repo: 'Repository',
  feature: 'Feature',
  ticket: 'Jira ticket',
  note: 'Note',
  todo: 'Todo',
  terminal: 'Terminal task',
}

type ArchivePanelProps = {
  nodes: WorkNode[]
  sessions: TerminalSession[]
  busy: boolean
  onRestore(nodeId: string): void
  onClose(): void
}

export function ArchivePanel({ nodes, sessions, busy, onRestore, onClose }: ArchivePanelProps) {
  const [query, setQuery] = useState('')
  const entries = useMemo(() => archivedNodeEntries(nodes, query), [nodes, query])
  const sessionByNode = useMemo(() => new Map(sessions.map((session) => [session.nodeId, session])), [sessions])
  const archivedCount = archivedNodeEntries(nodes, '').length

  return (
    <aside className="side-panel archive-panel" aria-label="Archived nodes">
      <header className="side-panel-header">
        <div><span>Workspace history</span><h2>Archive</h2></div>
        <button className="side-panel-close" type="button" onClick={onClose} aria-label="Close archive" title="Close panel"><Cross2Icon /></button>
      </header>

      <label className="archive-search">
        <MagnifyingGlassIcon />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archived nodes" />
        <span>{entries.length}/{archivedCount}</span>
      </label>

      {entries.length === 0 ? (
        <div className="archive-empty"><ArchiveIcon /><strong>{query ? 'No matches' : 'Archive is empty'}</strong><span>{query ? 'Try a title, ticket, project, or note.' : 'Completed work will stay searchable here.'}</span></div>
      ) : (
        <div className="archive-list" role="tree" aria-label="Archived node hierarchy">
          {entries.map((entry) => {
            const session = sessionByNode.get(entry.node.id)
            return (
              <article className="archive-row" key={entry.node.id} role="treeitem" aria-level={entry.depth + 1} style={{ '--archive-depth': entry.depth, '--archive-color': entry.node.color } as CSSProperties}>
                <span className="archive-rail" aria-hidden="true" />
                <div className="archive-row-copy">
                  <div><strong>{entry.node.title}</strong><small>{typeLabels[entry.node.type]}</small></div>
                  <code title={entry.path}>{entry.path}</code>
                  <span>{entry.inherited ? 'Archived with parent' : `Archived ${new Date(entry.node.archivedAt!).toLocaleDateString()}`}{session ? ` · ${session.backend} ${session.status}` : ''}</span>
                </div>
                {!entry.inherited && <button type="button" onClick={() => onRestore(entry.node.id)} disabled={busy} title="Restore to its original parent"><ReloadIcon />Restore</button>}
              </article>
            )
          })}
        </div>
      )}
    </aside>
  )
}
