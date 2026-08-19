import assert from 'node:assert/strict'
import test from 'node:test'
import { agentStatusText } from './agentStatus.ts'

test('agent status stays compact and reports active duration', () => {
  const since = '2026-08-07T10:00:00.000Z'
  assert.equal(agentStatusText({ kind: 'codex', state: 'working', since }, Date.parse('2026-08-07T10:07:00.000Z')), 'Codex · Working 7m')
  assert.equal(agentStatusText({ kind: 'claude', state: 'delegated', since }, Date.parse('2026-08-07T10:36:00.000Z')), 'Claude Code · Working (background) 36m')
  assert.equal(agentStatusText({ kind: 'claude', state: 'needs_input', since }, Date.parse('2026-08-07T11:02:00.000Z')), 'Claude Code · Needs input 1h 2m')
  assert.equal(agentStatusText({ kind: 'codex', state: 'completed', since }), 'Codex · Completed')
  assert.equal(agentStatusText({ kind: 'codex', state: 'read', since }), 'Codex · Read')
  assert.equal(agentStatusText({ kind: 'codex', state: 'unavailable' }), 'Codex · Status unavailable')
  assert.equal(agentStatusText({ kind: 'ssh', state: 'unavailable' }), 'SSH')
})
