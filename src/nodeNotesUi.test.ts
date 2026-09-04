import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('node notes UI supports human add, edit, delete, and map links', () => {
  const notes = readFileSync(new URL('./NodeNotes.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(notes, /onAdd\(draft:/)
  assert.match(notes, /onUpdate\(id:/)
  assert.match(notes, /onDelete\(id:/)
  assert.match(notes, /Confirm delete note/)
  assert.match(notes, /target="_blank" rel="noopener noreferrer"/)
  assert.match(app, /<NodeNotesPreview notes=\{node\.notes\}/)
  assert.match(app, /<NodeNotesEditor/)
})

test('terminal link activation records context without blocking navigation', () => {
  const panel = readFileSync(new URL('./TerminalPanel.tsx', import.meta.url), 'utf8')
  assert.match(panel, /`\/api\/nodes\/\$\{node\.id\}\/notes`/)
  assert.match(panel, /`terminal:\$\{session\.id\}`/)
  assert.match(panel, /\.catch\(\(\) => undefined\)/)
})
