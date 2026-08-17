import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('session binding rows are selectable and copyable in details and terminal panels', () => {
  const component = readFileSync(new URL('./SessionBindingCard.tsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const terminal = readFileSync(new URL('./TerminalPanel.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(component, /navigator\.clipboard\?\.writeText[\s\S]*navigator\.clipboard\.writeText\(value\)/)
  assert.match(component, /document\.execCommand\('copy'\)/)
  assert.match(component, /aria-label=\{`Copy \$\{row\.label\}`\}/)
  assert.match(component, /className="session-binding-value"/)
  assert.match(component, /className="session-binding-copy"/)
  assert.match(app, /<SessionBindingCard session=\{session\} \/>/)
  assert.match(terminal, /<SessionBindingCard session=\{session\} statusLabel=\{session\.agent \? agentStatusText\(session\.agent\) : status\} className="terminal-agent-session is-wide" \/>/)
  assert.match(css, /\.session-binding-value\s*\{[^}]*user-select:\s*text/s)
  assert.match(css, /\.session-binding-copy\s*\{[^}]*cursor:\s*pointer/s)
})
