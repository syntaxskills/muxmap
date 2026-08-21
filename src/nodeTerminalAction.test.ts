import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('a terminal-enabled node has no duplicate open-terminal button', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /node-terminal-action/)
  assert.doesNotMatch(css, /node-terminal-action/)
})

test('opening a completed or delegated terminal acknowledges it as read', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /\['completed', 'delegated'\]\.includes\(restored\.agent\.state\)/)
  assert.match(app, /\/api\/sessions\/\$\{restored\.id\}\/agent\/read/)
})

test('terminal sessions can be suspended manually and resumed without starting fresh', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /async function suspendSession/)
  assert.match(app, /\/api\/sessions\/\$\{sessionId\}\/suspend/)
  assert.match(app, /Suspend terminal/)
  assert.match(app, /Resume terminal/)
  assert.match(app, /attachTerminal\(Boolean\(session && session\.status !== 'suspended'\)\)/)
})

test('terminal auto suspend is driven by settings and keeps the current terminal', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /settings\['terminal\.autoSuspend'\]/)
  assert.match(app, /settings\['terminal\.maxActiveSessions'\]/)
  assert.match(app, /\/api\/sessions\/auto-suspend/)
  assert.match(app, /keepSessionId: terminalSessionId/)
})
