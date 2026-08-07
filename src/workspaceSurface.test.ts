import assert from 'node:assert/strict'
import test from 'node:test'
import { closeTerminal, floatTerminal, openRightPanel, openTerminal, selectNodeSurface } from './workspaceSurface.ts'

test('docked terminal and right panel share one mutually exclusive slot', () => {
  const docked = openTerminal({ rightPanel: 'details', terminalSessionId: null, terminalFloating: false }, 'session-1')
  assert.deepEqual(docked, { rightPanel: null, terminalSessionId: 'session-1', terminalFloating: false })
  assert.deepEqual(openRightPanel(docked, 'settings'), { rightPanel: 'settings', terminalSessionId: null, terminalFloating: false })
  assert.deepEqual(selectNodeSurface('session-2'), { rightPanel: null, terminalSessionId: 'session-2', terminalFloating: false })
  assert.deepEqual(selectNodeSurface(null), { rightPanel: 'details', terminalSessionId: null, terminalFloating: false })
})

test('floating terminal can coexist with exactly one right panel', () => {
  const docked = openTerminal({ rightPanel: null, terminalSessionId: null, terminalFloating: false }, 'session-1')
  const floating = floatTerminal(docked)
  assert.deepEqual(floating, { rightPanel: 'details', terminalSessionId: 'session-1', terminalFloating: true })
  assert.deepEqual(openRightPanel(floating, 'sessions'), { rightPanel: 'sessions', terminalSessionId: 'session-1', terminalFloating: true })
  assert.deepEqual(openRightPanel(openRightPanel(floating, 'sessions'), 'settings'), { rightPanel: 'settings', terminalSessionId: 'session-1', terminalFloating: true })
  assert.deepEqual(openRightPanel(openRightPanel(floating, 'settings'), 'settings'), { rightPanel: null, terminalSessionId: 'session-1', terminalFloating: true })
  assert.deepEqual(floatTerminal(floating), { rightPanel: null, terminalSessionId: 'session-1', terminalFloating: false })
  assert.deepEqual(closeTerminal(floating), { rightPanel: 'details', terminalSessionId: null, terminalFloating: false })
  assert.deepEqual(closeTerminal(openRightPanel(floating, 'settings')), { rightPanel: 'settings', terminalSessionId: null, terminalFloating: false })
})
