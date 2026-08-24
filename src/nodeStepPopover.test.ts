import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('node lifecycle popover renders as a narrow top rail with per-step details', () => {
  assert.match(css, /\.node-step-popover\s*\{[^}]*bottom:\s*calc\(100% \+ 8px\)/s)
  assert.match(css, /\.node-step-popover\s*\{[^}]*width:\s*184px/s)
  assert.match(css, /\.node-step-popover\s*\{[^}]*visibility:\s*hidden/s)
  assert.match(css, /\.map-node:hover \.node-step-popover,[\s\S]*?\.map-node:focus-within \.node-step-popover\s*\{[^}]*visibility:\s*visible/s)
  assert.match(css, /\.node-step-popover ol\s*\{[^}]*display:\s*flex/s)
  assert.match(css, /\.node-step-popover li:not\(:last-child\)::after\s*\{/)
  assert.match(css, /\.node-step-node:hover \.node-step-detail,[\s\S]*?visibility:\s*visible/s)
})

test('node lifecycle popover links live only inside the per-step detail panel', () => {
  assert.match(app, /className="node-step-node"/)
  assert.match(app, /className="node-step-detail"/)
  assert.match(app, /target="_blank" rel="noopener noreferrer"/)
})
