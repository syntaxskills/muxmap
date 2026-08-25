import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('terminal panel includes a command box with persisted history', () => {
  const panel = readFileSync(new URL('./TerminalPanel.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(panel, /terminal-command-box/)
  assert.doesNotMatch(panel, /Command input/)
  assert.doesNotMatch(panel, /Voice input/)
  assert.match(panel, /rows=\{3\}/)
  assert.match(panel, /Type or paste… double Enter to send/)
  assert.match(panel, /commandInputEnterAction/)
  assert.match(panel, /input-history/)
  assert.match(panel, /navigateCommandHistory/)
  assert.match(panel, /commandInputSubmissionWrites/)
  assert.match(panel, /COMMAND_SUBMIT_ENTER_DELAY_MS/)
  assert.match(panel, /terminal-command-enter-hint/)
  assert.match(css, /\.terminal-command-box/)
  assert.match(css, /\.terminal-command-box\.is-enter-armed/)
  assert.match(css, /resize:\s*none/)
  assert.match(css, /min-height:\s*76px/)
  assert.match(css, /\.terminal-command-actions \.is-send/)
  assert.match(css, /\.terminal-command-actions \.is-history/)
})
