import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('a terminal-enabled node has no duplicate open-terminal button', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /node-terminal-action/)
  assert.doesNotMatch(css, /node-terminal-action/)
})

test('opening completed or standby terminal acknowledges it without dismissing delegated background work', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /\['completed', 'standby'\]\.includes\(restored\.agent\.state\)/)
  assert.doesNotMatch(app, /\['completed', 'delegated', 'standby'\]\.includes\(restored\.agent\.state\)/)
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

test('opening a suspended terminal shows a centered resume panel with a faded agent badge', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(app, /activeTerminal\.status === 'suspended'/)
  assert.match(app, /className="terminal-suspended-body"/)
  assert.match(app, /Resume terminal/)
  assert.match(app, /activeTerminal\.agent \? <AgentIcon kind=\{activeTerminal\.agent\.kind\} \/> : <PauseIcon \/>/)
  assert.match(app, /statusAgent = item\.status === 'suspended' \? item\.agent : visibleAgent/)
  assert.match(css, /\.terminal-suspended-body\s*\{[^}]*place-items:\s*center/s)
  assert.match(css, /\.terminal-badge\.is-suspended \.agent-icon[\s\S]*opacity:\s*0\.42/)
})

test('terminal auto suspend is driven by settings and keeps the current terminal', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

  assert.match(app, /settings\['terminal\.autoSuspend'\]/)
  assert.match(app, /settings\['terminal\.maxActiveSessions'\]/)
  assert.match(app, /\/api\/sessions\/auto-suspend/)
  assert.match(app, /keepSessionId: terminalSessionId/)
})

test('self-hosting runtimes are shown as protected instead of orphan actions', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(app, /const selfHosting = graph\?\.selfHosting \?\? \[\]/)
  assert.match(app, /<h3>Self-hosting <span>\{selfHosting\.length\}<\/span><\/h3>/)
  assert.match(app, /Protected · hosting MuxMap server/)
  assert.match(app, /Cannot stop from MuxMap/)
  assert.match(css, /\.session-row\.is-self-hosting\s*\{/)
  assert.match(css, /\.protected-session-label\s*\{/)
})
