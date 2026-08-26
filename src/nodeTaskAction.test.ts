import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('todo nodes use only a corner marker for open todo state', () => {
  assert.match(app, /<BoxIcon \/>Mark todo/)
  assert.match(app, /<CheckboxIcon \/>Mark done/)
  assert.match(app, /className="node-todo-marker"/)
  assert.match(app, /<\/button>\s*\{hasOpenTodo && <span className="node-todo-marker"/)
  assert.match(app, /node\.type === 'todo' && !node\.doneAt/)
  assert.doesNotMatch(app, /className="node-task-action"/)
  assert.doesNotMatch(app, /Undo done/)
  assert.match(css, /\.node-todo-marker\s*\{[^}]*position:\s*absolute/s)
  assert.doesNotMatch(css, /\.node-task-action\s*\{/)
  assert.doesNotMatch(css, /\.map-node\.is-done \.node-title\s*\{[^}]*text-decoration:\s*line-through/s)
})

test('agent sessions expose a right-click status submenu', () => {
  assert.match(app, /function AgentStatusSubmenu/)
  assert.match(app, /useFloating\(\{[\s\S]*placement:\s*'right-start'[\s\S]*offset\(-2\)[\s\S]*flip\(\)/)
  assert.match(app, /useHover\(context,\s*\{\s*handleClose:\s*safePolygon\(\)\s*\}\)/)
  assert.match(app, /useFocus\(context\)/)
  assert.match(app, /useDismiss\(context\)/)
  assert.match(app, /Set agent status/)
  assert.match(app, /onSetStatus\(sessionId, 'working'\)/)
  assert.match(app, /onSetStatus\(sessionId, 'delegated'\)/)
  assert.match(app, /onSetStatus\(sessionId, 'standby'\)/)
  assert.match(app, /onSetStatus\(sessionId, 'completed'\)/)
  assert.match(app, /onSetStatus\(sessionId, 'read'\)/)
  assert.match(app, /<AgentStatusSubmenu nodeTitle=\{node\.title\} sessionId=\{agentSession\.id\} onSetStatus=\{setAgentStatus\} \/>/)
  assert.match(css, /\.node-context-submenu-panel\s*\{[^}]*position:\s*absolute/s)
  assert.match(css, /\.node-context-submenu-panel\.is-open\s*\{[^}]*pointer-events:\s*auto/s)
  assert.doesNotMatch(css, /\.node-context-submenu:hover \.node-context-submenu-panel/s)
  assert.doesNotMatch(css, /\.node-context-submenu:focus-within \.node-context-submenu-panel/s)
})

test('agent status submenu renders all manual status choices', () => {
  const submenu = app.match(/function AgentStatusSubmenu[\s\S]*?\r?\n}\r?\n\r?\nfunction App/)?.[0] ?? ''
  assert.match(submenu, />Working<\/button>/)
  assert.match(submenu, />Background<\/button>/)
  assert.match(submenu, />Completed<\/button>/)
  assert.match(submenu, />Read<\/button>/)
})
