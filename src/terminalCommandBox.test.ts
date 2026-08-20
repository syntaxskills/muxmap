import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('terminal panel includes a voice-friendly command box with persisted history', () => {
  const panel = readFileSync(new URL('./TerminalPanel.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(panel, /terminal-command-box/)
  assert.match(panel, /Voice input/)
  assert.match(panel, /input-history/)
  assert.match(panel, /navigateCommandHistory/)
  assert.match(panel, /terminalInputData/)
  assert.match(css, /\.terminal-command-box/)
})
