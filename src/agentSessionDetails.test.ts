import assert from 'node:assert/strict'
import test from 'node:test'
import { agentSessionDetails, agentSessionSummary, shortSessionId } from './agentSessionDetails.ts'
import type { TerminalSession } from './model.ts'

const session: TerminalSession = {
  id: 'sess_dev_1420',
  workspaceId: 'default',
  nodeId: 'dev-1420',
  name: 'tmux:default:dev-1420',
  runtimeName: 'muxmap-default-dev-1420',
  backend: 'tmux',
  cwd: '/repo/project',
  status: 'running',
  createdAt: '',
  updatedAt: '',
}

test('agent session details expose external agent ids alongside MuxMap runtime ids', () => {
  const withAgent: TerminalSession = {
    ...session,
    agent: {
      kind: 'codex',
      state: 'working',
      since: '2026-08-14T04:00:00.000Z',
      externalSessionId: '019fd54a-12a9-72c2-8a66-ee62fc1c546e',
      externalSessionPath: '/home/user/.codex/sessions/2026/08/14/session.jsonl',
      externalCwd: '/repo/project/src',
    },
  }

  assert.equal(agentSessionSummary(withAgent), 'Codex 019fd54a…546e')
  assert.deepEqual(agentSessionDetails(withAgent), [
    { label: 'Codex session', value: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' },
    { label: 'Session file', value: '/home/user/.codex/sessions/2026/08/14/session.jsonl' },
    { label: 'Agent cwd', value: '/repo/project/src' },
    { label: 'MuxMap session', value: 'sess_dev_1420' },
    { label: 'Runtime', value: 'tmux:muxmap-default-dev-1420' },
    { label: 'Terminal cwd', value: '/repo/project' },
  ])
})

test('terminal-only sessions still show stable MuxMap runtime identifiers', () => {
  assert.equal(agentSessionSummary(session), 'tmux muxmap-default-dev-1420')
  assert.deepEqual(agentSessionDetails(session), [
    { label: 'MuxMap session', value: 'sess_dev_1420' },
    { label: 'Runtime', value: 'tmux:muxmap-default-dev-1420' },
    { label: 'Terminal cwd', value: '/repo/project' },
  ])
  assert.equal(shortSessionId('abc'), 'abc')
})
