import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND_DOUBLE_ENTER_MS, COMMAND_SUBMIT_ENTER_DELAY_MS, MAX_BROWSER_TERMINAL_SCROLLBACK, coalesceTerminalSgrWheelLines, commandInputEnterAction, commandInputSubmissionWrites, consumeTerminalWheel, dragOffset, drainTerminalOutputBuffer, forceTerminalTextSelection, normalizeTerminalOpacity, normalizeTerminalSplit, shouldCopyTerminalSelection, shouldDropDuplicateTerminalInput, stopSessionIntent, terminalScrollbackLimit, terminalShortcutData, terminalSgrWheelBatchReports, terminalSgrWheelReports, terminalWheelHandledByApplication } from './terminalInteraction.ts'

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

test('terminal wheel accumulates trackpad movement into scrollback lines', () => {
  assert.deepEqual(consumeTerminalWheel(0, 2, 0, 30, 16), { lines: 0, remainder: 8 })
  assert.deepEqual(consumeTerminalWheel(8, 2, 0, 30, 16), { lines: 1, remainder: 0 })
  assert.deepEqual(consumeTerminalWheel(0, 16, 0, 30, 16), { lines: 4, remainder: 0 })
  assert.deepEqual(consumeTerminalWheel(0, -1, 1, 30, 16), { lines: -3, remainder: 0 })
  assert.deepEqual(consumeTerminalWheel(0, 1, 2, 24, 16), { lines: 24, remainder: 0 })
})

test('terminal wheel follows Ghostty-style precision and discrete multipliers', () => {
  assert.deepEqual(consumeTerminalWheel(0, 16, 0, 30, 16, { precision: 1, discrete: 3 }), { lines: 1, remainder: 0 })
  assert.deepEqual(consumeTerminalWheel(0, 16, 0, 30, 16, { precision: 2, discrete: 3 }), { lines: 2, remainder: 0 })
  assert.deepEqual(consumeTerminalWheel(0, 1, 1, 30, 16, { precision: 1, discrete: 5 }), { lines: 5, remainder: 0 })
})

test('terminal wheel auto mode lets fullscreen terminal apps handle scrolling', () => {
  assert.equal(terminalWheelHandledByApplication(true, 'auto'), true)
  assert.equal(terminalWheelHandledByApplication(false, 'auto'), false)
  assert.equal(terminalWheelHandledByApplication(false, 'application'), true)
  assert.equal(terminalWheelHandledByApplication(true, 'muxmap'), false)
})

test('terminal wheel reports can be sent as proportional SGR mouse input', () => {
  assert.equal(terminalSgrWheelReports(0), '')
  assert.equal(terminalSgrWheelReports(-2), '\x1b[<64;1;1M\x1b[<64;1;1M')
  assert.equal(terminalSgrWheelReports(3), '\x1b[<65;1;1M\x1b[<65;1;1M\x1b[<65;1;1M')
  assert.equal(terminalSgrWheelReports(250).split('\x1b[<65;1;1M').length - 1, 200)
})

test('terminal wheel SGR reports coalesce into one frame payload', () => {
  assert.equal(coalesceTerminalSgrWheelLines(0, 12), 12)
  assert.equal(coalesceTerminalSgrWheelLines(12, 8), 20)
  assert.equal(coalesceTerminalSgrWheelLines(190, 40), 200)
  assert.equal(coalesceTerminalSgrWheelLines(-190, -40), -200)
  assert.equal(terminalSgrWheelBatchReports([2, 3, 4]), '\x1b[<65;1;1M'.repeat(9))
  assert.equal(terminalSgrWheelBatchReports([5, -2]), '\x1b[<65;1;1M'.repeat(3))
})

test('browser terminal scrollback is capped to reduce renderer and GC pressure', () => {
  assert.equal(MAX_BROWSER_TERMINAL_SCROLLBACK, 2000)
  assert.equal(terminalScrollbackLimit(undefined), 2000)
  assert.equal(terminalScrollbackLimit(1000), 1000)
  assert.equal(terminalScrollbackLimit(50000), 2000)
  assert.equal(terminalScrollbackLimit('2500'), 2000)
  assert.equal(terminalScrollbackLimit('bad'), 2000)
})

test('terminal mouse tracking cannot steal a primary-button text selection', () => {
  const event = { button: 0, altKey: false, shiftKey: false }
  assert.equal(forceTerminalTextSelection(event, true), true)
  assert.equal(event.altKey, true)
  assert.equal(event.shiftKey, true)
  assert.equal(forceTerminalTextSelection({ button: 2, altKey: false, shiftKey: false }, true), false)
  assert.equal(forceTerminalTextSelection({ button: 0, altKey: false, shiftKey: false }, false), false)
})

test('terminal input dedupe only drops repeated long bursts', () => {
  const previous = { data: '这两个问题能解决吗?', at: 1000 }
  assert.equal(shouldDropDuplicateTerminalInput('这两个问题能解决吗?', previous, 1200, true), true)
  assert.equal(shouldDropDuplicateTerminalInput('这两个问题能解决吗?', previous, 2600, true), false)
  assert.equal(shouldDropDuplicateTerminalInput('这两个问题能解决吗?', previous, 1200, false), false)
  assert.equal(shouldDropDuplicateTerminalInput('短句', { data: '短句', at: 1000 }, 1100, true), false)
  assert.equal(shouldDropDuplicateTerminalInput('另一句话', previous, 1200, true), false)
})

test('terminal command submission splits text and Enter into delayed writes', () => {
  assert.equal(COMMAND_SUBMIT_ENTER_DELAY_MS, 150)
  assert.deepEqual(commandInputSubmissionWrites('status'), ['status', '\r'])
  assert.deepEqual(commandInputSubmissionWrites('first line\nsecond line\r\nthird line'), ['first line\rsecond line\rthird line', '\r'])
  const longPaste = 'x'.repeat(4096)
  assert.deepEqual(commandInputSubmissionWrites(longPaste), [longPaste, '\r'])
})

test('terminal command input uses a 900ms double Enter window to submit', () => {
  assert.equal(COMMAND_DOUBLE_ENTER_MS, 900)
  assert.deepEqual(commandInputEnterAction({ value: 'explain this', disabled: false, shiftKey: false, lastEnterAt: null, now: 1000 }), {
    submit: false,
    forwardEnter: false,
    preventDefault: true,
    nextLastEnterAt: 1000,
  })
  assert.deepEqual(commandInputEnterAction({ value: 'explain this', disabled: false, shiftKey: false, lastEnterAt: 1000, now: 1900 }), {
    submit: true,
    forwardEnter: false,
    preventDefault: true,
    nextLastEnterAt: null,
  })
  assert.deepEqual(commandInputEnterAction({ value: 'explain this', disabled: false, shiftKey: false, lastEnterAt: 1000, now: 1901 }), {
    submit: false,
    forwardEnter: false,
    preventDefault: true,
    nextLastEnterAt: 1901,
  })
})

test('empty command input forwards one Enter only on the second press', () => {
  assert.deepEqual(commandInputEnterAction({ value: '   \n', disabled: false, shiftKey: false, lastEnterAt: null, now: 1000 }), {
    submit: false,
    forwardEnter: false,
    preventDefault: true,
    nextLastEnterAt: 1000,
  })
  assert.deepEqual(commandInputEnterAction({ value: '', disabled: false, shiftKey: false, lastEnterAt: 1000, now: 1800 }), {
    submit: false,
    forwardEnter: true,
    preventDefault: true,
    nextLastEnterAt: null,
  })
  assert.deepEqual(commandInputEnterAction({ value: '', disabled: false, shiftKey: false, lastEnterAt: 1000, now: 1901 }), {
    submit: false,
    forwardEnter: false,
    preventDefault: true,
    nextLastEnterAt: 1901,
  })
})

test('shift and disabled command input never submit or forward Enter', () => {
  for (const action of [
    commandInputEnterAction({ value: '', disabled: false, shiftKey: true, lastEnterAt: 1000, now: 1100 }),
    commandInputEnterAction({ value: '', disabled: true, shiftKey: false, lastEnterAt: 1000, now: 1100 }),
    commandInputEnterAction({ value: 'explain this', disabled: false, shiftKey: true, lastEnterAt: 1000, now: 1100 }),
    commandInputEnterAction({ value: 'explain this', disabled: true, shiftKey: false, lastEnterAt: 1000, now: 1100 }),
  ]) {
    assert.equal(action.submit, false)
    assert.equal(action.forwardEnter, false)
    assert.equal(action.preventDefault, false)
    assert.equal(action.nextLastEnterAt, null)
  }
})

test('terminal output draining batches chunks without dropping overflow', () => {
  const queue = ['ab', 'cdef', 'gh']
  assert.equal(drainTerminalOutputBuffer(queue, 5), 'abcde')
  assert.deepEqual(queue, ['f', 'gh'])
  assert.equal(drainTerminalOutputBuffer(queue, 100), 'fgh')
  assert.deepEqual(queue, [])
})

test('stopping a tmux session requires an explicit second action', () => {
  assert.equal(stopSessionIntent(false), 'confirm')
  assert.equal(stopSessionIntent(true), 'stop')
})
