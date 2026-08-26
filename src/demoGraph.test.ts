import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { demoWorkspaceGraph } from './demoGraph.ts'

test('agent demo graph covers long metadata and all visible agent states', () => {
  const states = new Set(demoWorkspaceGraph.sessions.flatMap((session) => session.agent?.state ?? []))
  assert.deepEqual([...states].sort(), ['completed', 'delegated', 'needs_input', 'read', 'standby', 'unavailable', 'working'])
  assert.ok(demoWorkspaceGraph.nodes.some((node) => (node.repoPath?.length ?? 0) > 100))
  assert.ok(demoWorkspaceGraph.nodes.some((node) => (node.note?.length ?? 0) > 130))
  assert.ok(demoWorkspaceGraph.nodes.some((node) => node.type === 'todo' && !node.doneAt))
  assert.ok(demoWorkspaceGraph.nodes.some((node) => node.archivedAt))
})

test('agent demo mode is loaded client-side and renders a static terminal for screenshots', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
  assert.match(app, /get\('demo'\) === 'agents'/)
  assert.match(app, /setGraph\(demoWorkspaceGraph\)/)
  assert.match(app, /className=\{`terminal terminal-window terminal-demo/)
  assert.match(app, /Demo mode uses synthetic data for screenshots/)
  assert.match(css, /\.terminal-demo-screen\s*\{/)
  assert.match(app, /<span className="demo-badge">Demo data<\/span>/)
})
