import assert from 'node:assert/strict'
import test from 'node:test'
import { addCommandHooks, agentActivityFromEvent, agentSessionInfoFromEvent, detectAgentKind, type ProcessInfo } from './agents.ts'

const processes: ProcessInfo[] = [
  { pid: 10, ppid: 1, command: 'bash' },
  { pid: 11, ppid: 10, command: 'node /home/me/.local/bin/codex --yolo' },
  { pid: 12, ppid: 11, command: '/vendor/codex/codex --yolo' },
  { pid: 20, ppid: 1, command: 'bash' },
  { pid: 21, ppid: 20, command: 'node /usr/local/bin/claude' },
  { pid: 30, ppid: 1, command: 'bash' },
  { pid: 31, ppid: 30, command: 'pi' },
  { pid: 40, ppid: 1, command: 'bash' },
  { pid: 41, ppid: 40, command: 'ssh devbox' },
  { pid: 50, ppid: 1, command: 'node server/index.ts' },
  { pid: 51, ppid: 50, command: 'rg codex claude pi ssh' },
]

test('agent kind is detected from tmux pane descendants without false node matches', () => {
  assert.equal(detectAgentKind(10, processes), 'codex')
  assert.equal(detectAgentKind(20, processes), 'claude')
  assert.equal(detectAgentKind(30, processes), 'pi')
  assert.equal(detectAgentKind(40, processes), 'ssh')
  assert.equal(detectAgentKind(50, processes), undefined)
})

test('Codex and Claude lifecycle hooks map to working, input, and completed states', () => {
  const working = agentActivityFromEvent('codex', { hook_event_name: 'UserPromptSubmit' }, '2026-08-07T10:00:00.000Z')
  assert.deepEqual(working, { kind: 'codex', state: 'working', since: '2026-08-07T10:00:00.000Z' })
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'PermissionRequest' }, '2026-08-07T10:02:00.000Z').state, 'needs_input')
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'Stop', last_assistant_message: 'All tests pass.' }, '2026-08-07T10:04:00.000Z').state, 'completed')
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'Stop', last_assistant_message: 'Which option should I use?' }, '2026-08-07T10:04:00.000Z').state, 'needs_input')
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'Notification', notification_type: 'agent_needs_input' }, '2026-08-07T10:05:00.000Z').state, 'needs_input')
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'Stop' }, '2026-08-07T10:06:00.000Z').state, 'completed')
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'SessionStart' }, '2026-08-07T10:07:00.000Z').state, 'read')
})

test('Codex lifecycle metadata extracts resumable session ids', () => {
  const direct = agentActivityFromEvent('codex', {
    hook_event_name: 'Stop',
    muxmap: {
      session_id: '019fd54a-12a9-72c2-8a66-ee62fc1c546e',
      session_path: '/home/user/.codex/sessions/session.jsonl',
      cwd: '/home/user/project',
    },
  })
  assert.equal(direct.externalSessionId, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
  assert.equal(direct.externalSessionPath, '/home/user/.codex/sessions/session.jsonl')
  assert.equal(direct.externalCwd, '/home/user/project')
  assert.equal(agentSessionInfoFromEvent({ payload: { session_id: 'abc' } }).externalSessionId, 'abc')
})

test('Pi extension events map to working and completed states', () => {
  assert.equal(agentActivityFromEvent('pi', { type: 'agent_start' }, '2026-08-07T10:00:00.000Z').state, 'working')
  assert.equal(agentActivityFromEvent('pi', { type: 'agent_end' }, '2026-08-07T10:01:00.000Z').state, 'completed')
})

test('hook installation preserves existing handlers and is idempotent', () => {
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing' }] }] }, setting: true }
  const once = addCommandHooks(existing, ['Stop', 'UserPromptSubmit'], 'node muxmap-hook.mjs codex')
  const twice = addCommandHooks(once, ['Stop', 'UserPromptSubmit'], 'node muxmap-hook.mjs codex')
  assert.equal((twice.hooks as { Stop: unknown[] }).Stop.length, 2)
  assert.equal((twice.hooks as { UserPromptSubmit: unknown[] }).UserPromptSubmit.length, 1)
  assert.equal(twice.setting, true)
})
