import assert from 'node:assert/strict'
import test from 'node:test'
import type { NodeNoteEntry } from './model.ts'
import { mergeNodeNotes, nodeNoteDisplayText, nodeNoteLinkUrl, nodeNoteProviderLabel, visibleNodeNotes } from './nodeNotes.ts'

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

test('file note navigation carries the clicked node without changing saved URLs or external links', () => {
  const origin = 'http://localhost:4782'
  for (const prefix of ['', origin]) {
    const saved = note({ url: `${prefix}/api/files/open?path=docs%2Fguide.md&cwd=%2Frepo&sessionId=other-session&nodeId=other-node&line=3#L3` })
    const link = new URL(nodeNoteLinkUrl(saved, origin)!, origin)
    assert.equal(link.searchParams.get('nodeId'), saved.nodeId)
    assert.equal(link.searchParams.get('path'), 'docs/guide.md')
    assert.equal(link.searchParams.get('cwd'), '/repo')
    assert.equal(link.searchParams.get('sessionId'), 'other-session')
    assert.equal(link.searchParams.get('line'), '3')
    assert.equal(link.hash, '#L3')
    assert.ok(saved.url?.includes('nodeId=other-node'))
  }
  const external = 'https://example.com/api/files/open?path=guide.md'
  assert.equal(nodeNoteLinkUrl(note({ url: external }), origin), external)
  assert.equal(nodeNoteLinkUrl(note({}), origin), undefined)
})
