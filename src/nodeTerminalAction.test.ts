import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('a terminal-enabled node has no duplicate open-terminal button', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.doesNotMatch(app, /node-terminal-action/)
  assert.doesNotMatch(css, /node-terminal-action/)
})
