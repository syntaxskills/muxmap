import assert from 'node:assert/strict'
import test from 'node:test'
import { readViewState, writeViewState } from './viewState.ts'

test('selected node and open terminal survive a refresh through the URL', () => {
  assert.deepEqual(readViewState('?node=ticket&terminal=session-1&view=float'), {
    selectedId: 'ticket',
    terminalSessionId: 'session-1',
    terminalFloating: true,
  })
  assert.equal(writeViewState('?check=browser', {
    selectedId: 'ticket',
    terminalSessionId: 'session-1',
    terminalFloating: false,
  }), '?check=browser&node=ticket&terminal=session-1')
})

test('closing a terminal removes terminal-only URL state', () => {
  assert.equal(writeViewState('?node=ticket&terminal=session-1&view=float', {
    selectedId: 'plain-node',
    terminalSessionId: null,
    terminalFloating: false,
  }), '?node=plain-node')
})
