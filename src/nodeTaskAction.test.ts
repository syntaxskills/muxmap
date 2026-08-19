import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('todo nodes use only a corner marker for open todo state', () => {
  assert.match(app, /<BoxIcon \/>Mark todo/)
  assert.match(app, /<CheckboxIcon \/>Mark done/)
  assert.match(app, /className="node-todo-marker"/)
  assert.match(app, /node\.type === 'todo' && !node\.doneAt/)
  assert.doesNotMatch(app, /className="node-task-action"/)
  assert.doesNotMatch(app, /Undo done/)
  assert.match(css, /\.node-todo-marker\s*\{[^}]*position:\s*absolute/s)
  assert.doesNotMatch(css, /\.node-task-action\s*\{/)
  assert.doesNotMatch(css, /\.map-node\.is-done \.node-title\s*\{[^}]*text-decoration:\s*line-through/s)
})

test('agent sessions expose a right-click status submenu', () => {
  assert.match(app, /Set agent status/)
  assert.match(app, /setAgentStatus\(agentSession\.id, 'working'\)/)
  assert.match(app, /setAgentStatus\(agentSession\.id, 'delegated'\)/)
  assert.match(app, /setAgentStatus\(agentSession\.id, 'completed'\)/)
  assert.match(app, /setAgentStatus\(agentSession\.id, 'read'\)/)
  assert.match(css, /\.node-context-submenu-panel\s*\{[^}]*position:\s*absolute/s)
  assert.match(css, /\.node-context-submenu:hover \.node-context-submenu-panel/s)
})
