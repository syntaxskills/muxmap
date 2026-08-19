import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('todo nodes expose quick done and undo actions beside the node', () => {
  assert.match(app, /☐ Mark todo/)
  assert.match(app, /☑ Mark done/)
  assert.match(app, /className="node-task-action"/)
  assert.match(app, /node\.doneAt \? 'Undo done' : 'Mark done'/)
  assert.match(css, /\.node-task-action\s*\{[^}]*position:\s*absolute/s)
  assert.match(css, /\.map-node\.is-done \.node-title\s*\{[^}]*text-decoration:\s*line-through/s)
})
