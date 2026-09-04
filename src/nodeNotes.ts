import type { NodeNoteEntry, NodeNoteProvider } from './model.ts'

const providerLabels: Record<NodeNoteProvider, string> = {
  note: 'Note', jira: 'Jira', github: 'GH', gitlab: 'GL', lark: 'Lark', file: 'File', web: 'Web', agent: 'AI',
}

export function nodeNoteProviderLabel(provider: NodeNoteProvider) {
  return providerLabels[provider]
}

export function nodeNoteDisplayText(note: NodeNoteEntry) {
  if (note.label) return note.label
  if (note.body) return note.body
  if (note.url?.startsWith('/api/files/open?')) {
    const path = new URLSearchParams(note.url.split('?')[1] ?? '').get('path')
    if (path) return path.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/')
  }
  if (note.url) {
    try {
      const url = new URL(note.url)
      return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`
    } catch {
      return note.url
    }
  }
  return 'Untitled note'
}

export function visibleNodeNotes(notes: readonly NodeNoteEntry[] | undefined, limit = 3) {
  return [...(notes ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit)
}

export function mergeNodeNotes(...groups: Array<readonly NodeNoteEntry[] | undefined>) {
  const byId = new Map<string, NodeNoteEntry>()
  for (const note of groups.flatMap((group) => [...(group ?? [])])) {
    const current = byId.get(note.id)
    if (!current || note.updatedAt >= current.updatedAt) byId.set(note.id, note)
  }
  return visibleNodeNotes([...byId.values()], byId.size)
}
