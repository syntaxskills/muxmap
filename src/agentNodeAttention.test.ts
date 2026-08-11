import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('completed agent attention animates the full node and honors reduced motion', () => {
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
  assert.match(css, /\.map-node\.is-agent-completed\s+\.node-select\s*\{[^}]*animation:\s*agent-node-completed/s)
  assert.match(css, /prefers-reduced-motion:[^)]+\)[\s\S]*\.map-node\.is-agent-completed\s+\.node-select[\s\S]*animation:\s*none/)
})
