import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('terminal details agent event list uses a readable non-gray event card', () => {
  const terminalEventList = css.match(/\.terminal-node-editor \.agent-event-list\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const terminalEventText = css.match(/\.terminal-node-editor \.agent-event-list > summary,[\s\S]*?\.terminal-node-editor \.agent-event-list strong\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const terminalEventMuted = css.match(/\.terminal-node-editor \.agent-event-list p,[\s\S]*?\.terminal-node-editor \.agent-event-list > summary::after\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const terminalEventItems = css.match(/\.terminal-node-editor \.agent-event-list li\s*\{[\s\S]*?\n\}/)?.[0] ?? ''

  assert.doesNotMatch(terminalEventList, /background:\s*#171b18/)
  assert.match(terminalEventList, /background:\s*#f4efe3/)
  assert.match(terminalEventText, /color:\s*#182016/)
  assert.match(terminalEventMuted, /color:\s*#66705f/)
  assert.match(terminalEventItems, /background:\s*rgba\(255,\s*255,\s*255,\s*0\.56\)/)
})
