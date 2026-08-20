import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('mindmap exposes human-triggered agent channel creation and rendering', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(app, /Start chat channel/)
  assert.match(app, /Connect chat channel/)
  assert.match(app, /agent-channels/)
  assert.match(app, /className="agent-channel-edge"/)
  assert.match(app, /node-channel-marker/)
  assert.match(css, /\.edges path\.agent-channel-edge/)
  assert.match(css, /\.agent-channel-list/)
})
