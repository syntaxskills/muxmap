import { useState, type FormEvent, type MouseEvent, type PointerEvent } from 'react'
import { Cross2Icon, OpenInNewWindowIcon, Pencil2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import type { NodeNoteEntry } from './model.ts'
import { nodeNoteDisplayText, nodeNoteProviderLabel, visibleNodeNotes } from './nodeNotes.ts'

export type NodeNoteDraft = { label?: string; body?: string; url?: string }

function stop(event: MouseEvent | PointerEvent) {
  event.stopPropagation()
}

function ProviderBadge({ note }: { note: NodeNoteEntry }) {
  return <span className={`node-note-provider is-${note.provider}`}>{nodeNoteProviderLabel(note.provider)}</span>
}

export function NodeNotesPreview({ notes }: { notes?: readonly NodeNoteEntry[] }) {
  const visible = visibleNodeNotes(notes)
  if (visible.length === 0) return null
  return (
    <section className="node-notes-preview" aria-label="Node notes" onClick={stop} onPointerDown={stop}>
      <header><span>Notes & artifacts</span><small>{notes?.length ?? visible.length}</small></header>
      {visible.map((note) => {
        const content = <><ProviderBadge note={note} /><span title={note.body ?? note.url ?? note.label}>{nodeNoteDisplayText(note)}</span>{note.url && <OpenInNewWindowIcon aria-hidden="true" />}</>
        return note.url
          ? <a key={note.id} href={note.url} target="_blank" rel="noopener noreferrer">{content}</a>
          : <div key={note.id}>{content}</div>
      })}
    </section>
  )
}

type EditorProps = {
  notes?: readonly NodeNoteEntry[]
  disabled?: boolean
  onAdd(draft: NodeNoteDraft): Promise<void>
  onUpdate(id: string, draft: NodeNoteDraft): Promise<void>
  onDelete(id: string): Promise<void>
}

export function NodeNotesEditor({ notes, disabled, onAdd, onUpdate, onDelete }: EditorProps) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>, noteId?: string) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const draft = {
      label: String(data.get('label') ?? '').trim(),
      body: String(data.get('body') ?? '').trim(),
      url: String(data.get('url') ?? '').trim(),
    }
    if (!draft.body && !draft.url) return setSubmitError('Write a note or add a link.')
    setSubmitError('')
    try {
      if (noteId) {
        await onUpdate(noteId, draft)
        setEditingId(null)
      } else {
        await onAdd(draft)
        setAdding(false)
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to save note')
    }
  }

  return (
    <section className="node-notes-editor" aria-label="Node notes and artifacts">
      <header><div><strong>Notes & artifacts</strong><small>Human notes, agent updates, links, and opened files.</small></div><button type="button" onClick={() => { setSubmitError(''); setAdding(true) }} disabled={disabled || adding}><PlusIcon />Add</button></header>
      {submitError && <p className="node-note-error" role="alert">{submitError}</p>}
      {adding && <form className="node-note-form" onSubmit={(event) => void submit(event)}>
        <textarea name="body" rows={3} placeholder="Write context or an update…" autoFocus />
        <input name="label" placeholder="Link label (optional)" />
        <input name="url" type="text" inputMode="url" placeholder="https://… (optional)" />
        <div><button type="button" onClick={() => setAdding(false)}><Cross2Icon />Cancel</button><button className="is-primary" type="submit" disabled={disabled}>Save note</button></div>
      </form>}
      <div className="node-note-list">
        {(notes ?? []).length === 0 && !adding && <p>No notes yet. Links opened from this node's terminal will appear here.</p>}
        {visibleNodeNotes(notes, 100).map((note) => editingId === note.id ? (
          <form className="node-note-form is-editing" key={note.id} onSubmit={(event) => void submit(event, note.id)}>
            <textarea name="body" rows={3} defaultValue={note.body} placeholder="Note or update" autoFocus />
            <input name="label" defaultValue={note.label} placeholder="Link label" />
            <input name="url" type="text" inputMode="url" defaultValue={note.url} placeholder="https://…" />
            <div><button type="button" onClick={() => setEditingId(null)}>Cancel</button><button className="is-primary" type="submit" disabled={disabled}>Save</button></div>
          </form>
        ) : (
          <article className={`node-note-item is-${note.provider}`} key={note.id}>
            <ProviderBadge note={note} />
            <div>{note.url ? <a href={note.url} target="_blank" rel="noopener noreferrer">{nodeNoteDisplayText(note)}<OpenInNewWindowIcon /></a> : <strong>{nodeNoteDisplayText(note)}</strong>}{note.body && note.label && <p>{note.body}</p>}<small>{note.createdBy.startsWith('terminal:') ? 'Opened from terminal' : note.createdBy === 'human' ? 'Edited by human' : 'Agent update'} · {new Date(note.updatedAt).toLocaleString()}</small></div>
            <div className="node-note-actions"><button type="button" onClick={() => { setSubmitError(''); setEditingId(note.id); setConfirmDeleteId(null) }} title="Edit note" aria-label="Edit note"><Pencil2Icon /></button><button className={confirmDeleteId === note.id ? 'is-confirming' : ''} type="button" onClick={() => { if (confirmDeleteId !== note.id) return setConfirmDeleteId(note.id); void onDelete(note.id).then(() => setConfirmDeleteId(null)).catch(() => undefined) }} title={confirmDeleteId === note.id ? 'Confirm delete' : 'Delete note'} aria-label={confirmDeleteId === note.id ? 'Confirm delete note' : 'Delete note'}>{confirmDeleteId === note.id ? 'Delete?' : <TrashIcon />}</button></div>
          </article>
        ))}
      </div>
    </section>
  )
}
