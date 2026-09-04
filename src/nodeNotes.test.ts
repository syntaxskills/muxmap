import assert from 'node:assert/strict'
import test from 'node:test'
import type { NodeNoteEntry } from './model.ts'
import { mergeNodeNotes, nodeNoteDisplayText, nodeNoteProviderLabel, visibleNodeNotes } from './nodeNotes.ts'

const note = (patch: Partial<NodeNoteEntry>): NodeNoteEntry => ({
  id: 'note-1', nodeId: 'node-1', kind: 'text', provider: 'note',
  createdBy: 'human', updatedBy: 'human',
  createdAt: '2026-09-04T10:00:00.000Z', updatedAt: '2026-09-04T10:00:00.000Z',
  ...patch,
})

test('node note labels prioritize human labels and keep compact fallbacks', () => {
  assert.equal(nodeNoteDisplayText(note({ label: 'DEV-2830', url: 'https://jira.example/browse/DEV-2830' })), 'DEV-2830')
  assert.equal(nodeNoteDisplayText(note({ body: 'Implementation decision and context.' })), 'Implementation decision and context.')
  assert.equal(nodeNoteDisplayText(note({ kind: 'file', provider: 'file', url: '/api/files/open?path=src%2FApp.tsx' })), 'src/App.tsx')
  assert.equal(nodeNoteProviderLabel('github'), 'GH')
  assert.equal(nodeNoteProviderLabel('lark'), 'Lark')
})

test('node note preview stays compact and keeps newest ordering', () => {
  const notes = [1, 2, 3, 4].map((index) => note({ id: `note-${index}`, updatedAt: `2026-09-04T10:0${index}:00.000Z` }))
  assert.deepEqual(visibleNodeNotes(notes, 3).map((item) => item.id), ['note-4', 'note-3', 'note-2'])
  assert.deepEqual(mergeNodeNotes(notes.slice(0, 2), [note({ id: 'note-2', body: 'Newer copy', updatedAt: '2026-09-04T11:00:00.000Z' }), notes[3]]).map((item) => [item.id, item.body]), [
    ['note-2', 'Newer copy'], ['note-4', undefined], ['note-1', undefined],
  ])
})
