import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('agent node attention distinguishes working, completed, and input-needed states', () => {
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(css, /\.map-node\.is-agent-working\s+\.node-select::after\s*\{[^}]*animation:\s*agent-working-sweep/s)
  assert.match(css, /\.map-node\.is-agent-working\s+\.node-select::after\s*\{[^}]*animation-delay:\s*var\(--agent-working-sweep-delay/s)
  assert.match(app, /synchronizeAgentWorkingSweeps\(document,\s*performance\.now\(\)\)/)
  assert.match(css, /\.is-completed\s*>\s*\.agent-icon\s*\{[^}]*animation:\s*agent-completed-jump/s)
  assert.doesNotMatch(css, /\.map-node\.is-agent-completed\s+\.node-select\s*\{[^}]*animation:/s)
  assert.match(css, /\.agent-needs-input-marker\s*\{[^}]*position:\s*absolute/s)
  assert.match(app, /agent-needs-input-marker[\s\S]*>\?<\/span>/)
  assert.match(app, /const visibleAgent = visibleAgentForSession\(nodeSession\)/)
  assert.match(app, /visibleAgent \? agentStatusText\(visibleAgent\) : nodeSession\.runtimeExists === false \? 'Terminal runtime missing'/)
  assert.match(css, /prefers-reduced-motion:[^)]+\)[\s\S]*\.map-node\.is-agent-working\s+\.node-select::after[\s\S]*animation:\s*none/)
})
