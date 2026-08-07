import assert from 'node:assert/strict'
import test from 'node:test'
import { dragOffset, forceTerminalTextSelection, normalizeTerminalOpacity, normalizeTerminalSplit, shouldCopyTerminalSelection, shouldHandleTerminalWheel, stopSessionIntent, terminalShortcutData } from './terminalInteraction.ts'

test('terminal dragging follows the pointer without changing its starting offset', () => {
  assert.deepEqual(dragOffset({ x: 20, y: -10 }, { x: 100, y: 80 }, { x: 145, y: 55 }), { x: 65, y: -35 })
})

test('terminal opacity is constrained to a readable global range', () => {
  assert.equal(normalizeTerminalOpacity(null), 96)
  assert.equal(normalizeTerminalOpacity('82'), 82)
  assert.equal(normalizeTerminalOpacity('20'), 45)
  assert.equal(normalizeTerminalOpacity('nope'), 96)
})

test('terminal split defaults to half and keeps both panes usable', () => {
  assert.equal(normalizeTerminalSplit(null), 50)
  assert.equal(normalizeTerminalSplit('62'), 62)
  assert.equal(normalizeTerminalSplit(62.4), 62)
  assert.equal(normalizeTerminalSplit(10), 25)
  assert.equal(normalizeTerminalSplit(90), 75)
})

test('command-delete clears the current shell line', () => {
  assert.equal(terminalShortcutData({ key: 'Backspace', metaKey: true, altKey: false }), '\x15')
  assert.equal(terminalShortcutData({ key: 'Delete', metaKey: true, altKey: false }), '\x15')
  assert.equal(terminalShortcutData({ key: 'Backspace', metaKey: false, altKey: false }), null)
})

test('mac terminal navigation jumps by word and line', () => {
  assert.equal(terminalShortcutData({ key: 'ArrowLeft', metaKey: false, altKey: true }), '\x1bb')
  assert.equal(terminalShortcutData({ key: 'ArrowRight', metaKey: false, altKey: true }), '\x1bf')
  assert.equal(terminalShortcutData({ key: 'ArrowLeft', metaKey: true, altKey: false }), '\x01')
  assert.equal(terminalShortcutData({ key: 'ArrowRight', metaKey: true, altKey: false }), '\x05')
})

test('terminal copy shortcuts stay in the browser when text is selected', () => {
  assert.equal(shouldCopyTerminalSelection({ key: 'c', metaKey: true, ctrlKey: false, shiftKey: false }, true), true)
  assert.equal(shouldCopyTerminalSelection({ key: 'C', metaKey: false, ctrlKey: true, shiftKey: true }, true), true)
  assert.equal(shouldCopyTerminalSelection({ key: 'c', metaKey: false, ctrlKey: true, shiftKey: false }, true), false)
  assert.equal(shouldCopyTerminalSelection({ key: 'c', metaKey: true, ctrlKey: false, shiftKey: false }, false), false)
})

test('terminal wheel never becomes arrow-key input in an alternate buffer', () => {
  assert.equal(shouldHandleTerminalWheel('normal'), true)
  assert.equal(shouldHandleTerminalWheel('alternate'), false)
})

test('terminal mouse tracking cannot steal a primary-button text selection', () => {
  const event = { button: 0, altKey: false, shiftKey: false }
  assert.equal(forceTerminalTextSelection(event, true), true)
  assert.equal(event.altKey, true)
  assert.equal(event.shiftKey, true)
  assert.equal(forceTerminalTextSelection({ button: 2, altKey: false, shiftKey: false }, true), false)
  assert.equal(forceTerminalTextSelection({ button: 0, altKey: false, shiftKey: false }, false), false)
})

test('stopping a tmux session requires an explicit second action', () => {
  assert.equal(stopSessionIntent(false), 'confirm')
  assert.equal(stopSessionIntent(true), 'stop')
})
