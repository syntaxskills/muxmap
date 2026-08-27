import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { addCommandHooks, agentActivityFromEvent, agentSessionInfoFromEvent, detectAgentKind, detectMuxMapHost, isMuxMapAgentHookCommand, shouldPreserveAgentState, type AgentTranscriptFs, type ProcessInfo } from './agents.ts'

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

function transcriptFs(mtimeMsByPath: Record<string, number>, unreadable = false): AgentTranscriptFs {
  return {
    readdirSync(dir: string) {
      if (unreadable) throw new Error('unreadable')
      return Object.keys(mtimeMsByPath)
        .filter((file) => file.startsWith(`${dir}/`))
        .map((file) => file.slice(dir.length + 1))
    },
    statSync(file: string) {
      const mtimeMs = mtimeMsByPath[file]
      if (mtimeMs === undefined) throw new Error('missing')
      return { mtimeMs }
    },
  }
}

test('agent kind is detected from tmux pane descendants without false node matches', () => {
  assert.equal(detectAgentKind(10, processes), 'codex')
  assert.equal(detectAgentKind(20, processes), 'claude')
  assert.equal(detectAgentKind(30, processes), 'pi')
  assert.equal(detectAgentKind(40, processes), 'ssh')
  assert.equal(detectAgentKind(50, processes), undefined)
})

test('MuxMap host detection follows the pane process tree', () => {
  assert.equal(detectMuxMapHost(60, [
    { pid: 60, ppid: 1, command: 'zsh' },
    { pid: 61, ppid: 60, command: 'node scripts/dev.mjs' },
    { pid: 62, ppid: 61, command: 'node --experimental-strip-types server/index.ts' },
  ]), true)
  assert.equal(detectMuxMapHost(70, [
    { pid: 70, ppid: 1, command: 'zsh' },
    { pid: 71, ppid: 70, command: 'node /usr/local/bin/codex' },
    { pid: 72, ppid: 1, command: 'node --experimental-strip-types server/index.ts' },
  ]), false)
})

test('Codex and Claude lifecycle hooks map to working, input, and completed states', () => {
  const working = agentActivityFromEvent('codex', { hook_event_name: 'UserPromptSubmit' }, '2026-08-07T10:00:00.000Z')
  assert.deepEqual(working, { kind: 'codex', state: 'working', since: '2026-08-07T10:00:00.000Z' })
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'PermissionRequest' }, '2026-08-07T10:02:00.000Z')!.state, 'needs_input')
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'Stop', last_assistant_message: 'All tests pass.' }, '2026-08-07T10:04:00.000Z')!.state, 'completed')
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'Stop', last_assistant_message: 'Which option should I use?' }, '2026-08-07T10:04:00.000Z')!.state, 'needs_input')
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'Notification', notification_type: 'agent_needs_input' }, '2026-08-07T10:05:00.000Z')!.state, 'needs_input')
  const idlePrompt = agentActivityFromEvent('claude', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, '2026-08-07T10:05:00.000Z')
  assert.equal(idlePrompt!.state, 'completed')
  assert.equal(shouldPreserveAgentState({ kind: 'claude', state: 'delegated', since: '2026-08-07T10:00:00.000Z' }, { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, idlePrompt), true)
  assert.equal(shouldPreserveAgentState({ kind: 'claude', state: 'standby', since: '2026-08-07T10:00:00.000Z' }, { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, idlePrompt), true)
  assert.equal(shouldPreserveAgentState({ kind: 'claude', state: 'working', since: '2026-08-07T10:00:00.000Z' }, { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, idlePrompt), false)
  assert.equal(shouldPreserveAgentState({ kind: 'claude', state: 'needs_input', since: '2026-08-07T10:00:00.000Z' }, { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, idlePrompt), true)
  assert.equal(shouldPreserveAgentState({ kind: 'claude', state: 'read', since: '2026-08-07T10:00:00.000Z' }, { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, idlePrompt), true)
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'Notification', notification_type: 'unknown' }, '2026-08-07T10:05:00.000Z'), null)
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'StopFailure' }, '2026-08-07T10:05:00.000Z')!.state, 'completed')
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'Stop' }, '2026-08-07T10:06:00.000Z')!.state, 'completed')
  assert.equal(agentActivityFromEvent('codex', { hook_event_name: 'SessionStart' }, '2026-08-07T10:07:00.000Z')!.state, 'read')
})

test('Claude PreToolUse clears permission prompts by marking the node working', () => {
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'PermissionRequest' })!.state, 'needs_input')
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'PreToolUse' })!.state, 'working')
  assert.equal(agentActivityFromEvent('claude', { hookEventName: 'PreToolUse' })!.state, 'working')
  assert.equal(agentActivityFromEvent('claude', { payload: { hook_event_name: 'PreToolUse' } })!.state, 'working')
  assert.equal(agentActivityFromEvent('claude', { payload: { hookEventName: 'Notification', notificationType: 'agent_needs_input' } })!.state, 'needs_input')
})

test('Claude Stop distinguishes compute delegation from passive monitor standby', () => {
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    last_assistant_message: 'I handed this off to a sub-agent earlier and all work is now done.',
    background_tasks: [],
    session_crons: [],
  })!.state, 'completed')
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    last_assistant_message: 'I am handing this off to a sub-agent and will continue when it returns.',
    background_tasks: [{ id: 'task-1' }],
  })!.state, 'delegated')
  const standby = agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    background_tasks: [{ id: 'artifact-1', type: 'monitor', description: 'live updates for artifact demo (auto-armed on publish)' }],
  }, '2026-08-07T10:04:00.000Z')
  assert.deepEqual(standby, {
    kind: 'claude',
    state: 'standby',
    since: '2026-08-07T10:04:00.000Z',
    standbyReason: 'live updates for artifact demo (auto-armed on publish)',
  })
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    background_tasks: [
      { id: 'artifact-1', type: 'monitor', description: 'live updates for artifact demo' },
      { id: 'task-1', type: 'subagent', description: 'continue implementation' },
    ],
  })!.state, 'delegated')
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    session_crons: [{ id: 'cron-1' }],
    last_assistant_message: 'The implementation agent will wake this session later.',
  })!.state, 'delegated')
})

test('Claude Stop verifies teammate delegation against subagent transcript liveness', () => {
  const now = '2026-08-07T12:00:00.000Z'
  const nowMs = Date.parse(now)
  const transcriptPath = '/home/user/.claude/projects/muxmap/session-123.jsonl'
  const subagentDir = '/home/user/.claude/projects/muxmap/session-123/subagents'
  const task = { id: 'teammate-1', type: 'teammate', description: 'continue implementation' }

  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    transcript_path: transcriptPath,
    background_tasks: [task],
  }, now, {
    fs: transcriptFs({ [`${subagentDir}/teammate-1.jsonl`]: nowMs - 5 * 60_000 }),
  })!.state, 'delegated')

  const stale = agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    transcript_path: transcriptPath,
    background_tasks: [task],
  }, now, {
    fs: transcriptFs({ [`${subagentDir}/teammate-1.jsonl`]: nowMs - 10 * 60 * 60_000 }),
  })
  assert.deepEqual(stale, {
    kind: 'claude',
    state: 'completed',
    since: now,
    staleTeammate: true,
    externalSessionPath: transcriptPath,
  })

  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    transcript_path: transcriptPath,
    background_tasks: [task],
  }, now, {
    fs: transcriptFs({}, true),
  })!.state, 'delegated')

  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'Stop',
    transcript_path: transcriptPath,
    background_tasks: [{ id: 'tool-1', type: 'workflow', description: 'run integration suite' }],
  }, now, {
    fs: transcriptFs({ [`${subagentDir}/tool-1.jsonl`]: nowMs - 10 * 60 * 60_000 }),
  })!.state, 'delegated')
})

test('Claude subagent start events mark working but finish events preserve current state', () => {
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'SubagentStart',
    agent_id: 'agent-001',
    agent_type: 'Explore',
  })!.state, 'working')
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'TaskCreated',
    task_id: 'task-001',
    task_subject: 'Implement session recovery',
  })!.state, 'working')
  assert.equal(agentActivityFromEvent('claude', {
    hook_event_name: 'TaskCompleted',
    task_id: 'task-001',
    task_subject: 'Implement session recovery',
  }), null)
  const subagentStop = agentActivityFromEvent('claude', {
    hook_event_name: 'SubagentStop',
    agent_id: 'agent-001',
    agent_type: 'Explore',
    agent_transcript_path: '/home/user/.claude/projects/repo/session/subagents/agent-001.jsonl',
    last_assistant_message: 'Analysis complete.',
  })
  assert.equal(subagentStop, null)
  assert.equal(agentActivityFromEvent('claude', { hook_event_name: 'Stop', last_assistant_message: 'All done.' })!.state, 'completed')
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
  assert.ok(direct)
  assert.equal(direct.externalSessionId, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
  assert.equal(direct.externalSessionPath, '/home/user/.codex/sessions/session.jsonl')
  assert.equal(direct.externalCwd, '/home/user/project')
  assert.equal(agentSessionInfoFromEvent({ payload: { session_id: 'abc' } }).externalSessionId, 'abc')
})

test('Claude lifecycle metadata extracts cross-session routing addresses', () => {
  const activity = agentActivityFromEvent('claude', {
    hook_event_name: 'SessionStart',
    muxmap: {
      cwd: '/home/user/project',
      messaging_protocol: 'claude-cross-session',
      messaging_socket: 'uds:/tmp/claude-peer.sock',
    },
  })

  assert.equal(activity?.messagingProtocol, 'claude-cross-session')
  assert.equal(activity?.messagingSocket, 'uds:/tmp/claude-peer.sock')
  assert.equal(activity?.externalCwd, '/home/user/project')
})

test('Pi extension events map to working and completed states', () => {
  assert.equal(agentActivityFromEvent('pi', { type: 'agent_start' }, '2026-08-07T10:00:00.000Z')!.state, 'working')
  assert.equal(agentActivityFromEvent('pi', { type: 'agent_end' }, '2026-08-07T10:01:00.000Z')!.state, 'completed')
  const withSession = agentActivityFromEvent('pi', { type: 'agent_end', session_id: 'pi-session', session_path: '/home/user/.pi/agent/sessions/pi.jsonl', cwd: '/home/user/project' }, '2026-08-07T10:01:00.000Z')
  assert.equal(withSession?.externalSessionId, 'pi-session')
  assert.equal(withSession?.externalSessionPath, '/home/user/.pi/agent/sessions/pi.jsonl')
  assert.equal(withSession?.externalCwd, '/home/user/project')
})

test('hook installation preserves existing handlers and is idempotent', () => {
  const existing = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing' }] }] }, setting: true }
  const once = addCommandHooks(existing, ['Stop', 'UserPromptSubmit'], 'node muxmap-hook.mjs codex')
  const twice = addCommandHooks(once, ['Stop', 'UserPromptSubmit'], 'node muxmap-hook.mjs codex')
  assert.equal((twice.hooks as { Stop: unknown[] }).Stop.length, 2)
  assert.equal((twice.hooks as { UserPromptSubmit: unknown[] }).UserPromptSubmit.length, 1)
  assert.equal(twice.setting, true)
})

test('hook installation updates stale MuxMap hook paths without touching user hooks', () => {
  const existing = {
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'existing' }] },
        { hooks: [{ type: 'command', command: 'node "/old/repo/muxmap/server/agent-hook.mjs" codex', timeout: 3 }] },
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'node "/old/repo/muxmap/server/agent-hook.mjs" codex', timeout: 3 }] },
      ],
    },
  }
  const next = addCommandHooks(existing, ['Stop', 'UserPromptSubmit'], 'node "/new/repo/muxmap/server/agent-hook.mjs" codex', 'codex')
  const hooks = next.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
  const stopCommands = hooks.Stop.flatMap((group) => group.hooks.map((hook) => hook.command))
  const promptCommands = hooks.UserPromptSubmit.flatMap((group) => group.hooks.map((hook) => hook.command))

  assert.deepEqual(stopCommands, ['existing', 'node "/new/repo/muxmap/server/agent-hook.mjs" codex'])
  assert.deepEqual(promptCommands, ['node "/new/repo/muxmap/server/agent-hook.mjs" codex'])
  assert.equal(isMuxMapAgentHookCommand('node "/new/repo/muxmap/server/agent-hook.mjs" codex', 'codex'), true)
  assert.equal(isMuxMapAgentHookCommand('node "/new/repo/muxmap/server/agent-hook.mjs" claude', 'codex'), false)
})

test('Claude hook installer includes the lightweight PreToolUse transition hook', () => {
  const installer = readFileSync(new URL('../scripts/install-agent-hooks.ts', import.meta.url), 'utf8')
  assert.match(installer, /'PermissionRequest', 'PreToolUse', 'Notification'/)
  assert.doesNotMatch(installer, /PostToolUse/)
})

test('Pi extension forwards optional session metadata for resume', () => {
  const extension = readFileSync(new URL('../integrations/pi-status.ts', import.meta.url), 'utf8')
  assert.match(extension, /session_id: sessionId/)
  assert.match(extension, /session_path: sessionPath/)
  assert.match(extension, /process\.cwd\(\)/)
})
