import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { IN_PAGE_NOTIFICATION_LIFETIME_MS } from './agentNotifications.ts'

test('in-page Agent notifications fade before their eight-second auto-dismiss', () => {
  assert.equal(IN_PAGE_NOTIFICATION_LIFETIME_MS, 8_000)
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
  assert.match(css, /\.agent-alert\s*\{[^}]*animation:\s*agent-alert-lifetime 8s/s)
  assert.match(css, /@keyframes agent-alert-lifetime\s*\{[\s\S]*100%\s*\{[^}]*opacity:\s*0/s)
})
