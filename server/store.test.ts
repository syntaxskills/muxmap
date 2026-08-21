import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createStore } from './store.ts'

test('workspace graph persists in SQLite across process restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-store-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    const initial = first.getWorkspace('default')
    assert.equal(initial.workspace.rootNodeId, 'workspace')
    assert.ok(initial.nodes.length >= 1)

    const created = first.createNode('default', {
      parentId: 'workspace',
      title: 'Persistent child',
      type: 'note',
      note: 'Saved in SQLite',
    })
    first.close()

    const second = createStore(database)
    assert.equal(second.getNode(created.id)?.title, 'Persistent child')
    assert.equal(second.getWorkspace('default').nodes.some((node) => node.id === created.id), true)
    second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy idle agent records migrate to read instead of alerting again', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-agent-migration-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    first.upsertAgentActivity('muxmap-old', { kind: 'codex', state: 'completed', since: '2026-08-07T10:00:00.000Z' })
    first.close()
    const legacy = new DatabaseSync(database)
    legacy.exec("UPDATE agent_activity SET state = 'idle'")
    legacy.close()

    const migrated = createStore(database)
    assert.equal(migrated.getAgentActivity('muxmap-old')?.state, 'read')
    migrated.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('agent activity stores external Codex resume metadata', () => {
  const store = createStore(':memory:')
  const activity = store.upsertAgentActivity('muxmap-codex', {
    kind: 'codex',
    state: 'completed',
    since: '2026-08-07T10:00:00.000Z',
    externalSessionId: '019fd54a-12a9-72c2-8a66-ee62fc1c546e',
    externalSessionPath: '/home/user/.codex/sessions/session.jsonl',
    externalCwd: '/home/user/project',
  })

  assert.equal(activity.externalSessionId, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
  assert.equal(store.getAgentActivity('muxmap-codex')?.externalSessionPath, '/home/user/.codex/sessions/session.jsonl')
  store.close()
})

test('agent event log stores recent hook payloads for debugging', () => {
  const store = createStore(':memory:')
  store.recordAgentEvent('muxmap-claude', 'claude', {
    hook_event_name: 'Notification',
    notification_type: 'idle_prompt',
    message: 'Claude finished responding.',
  }, 'read', '2026-08-07T10:00:00.000Z')
  store.recordAgentEvent('muxmap-claude', 'claude', {
    hook_event_name: 'Stop',
    background_tasks: [{ id: 'task-1', description: 'Run mvn test in the background' }],
  }, 'delegated', '2026-08-07T10:02:00.000Z')
  store.recordAgentEvent('muxmap-claude', 'claude', {
    payload: {
      hookEventName: 'SubagentStart',
      agentId: 'agent-1',
      agent_type: 'Explore',
    },
  }, 'working', '2026-08-07T10:01:00.000Z')

  const events = store.listAgentEvents('muxmap-claude')
  assert.equal(events.length, 3)
  assert.equal(events[0].eventName, 'Stop')
  assert.equal(events[0].state, 'delegated')
  assert.equal(events[0].summary, 'Run mvn test in the background')
  assert.equal(events[1].eventName, 'SubagentStart')
  assert.equal(events[1].agentId, 'agent-1')
  assert.equal(events[1].agentType, 'Explore')
  assert.equal(events[2].notificationType, 'idle_prompt')
  assert.equal(events[2].summary, 'Claude finished responding.')
  assert.equal(events[2].payload.notification_type, 'idle_prompt')
  store.close()
})

test('agent activity rebuilds from event log on startup instead of trusting stale snapshots', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-agent-replay-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    first.recordAgentEvent('muxmap-claude-completed', 'claude', { hook_event_name: 'Stop' }, 'completed', '2026-08-07T10:00:00.000Z')
    first.recordAgentEvent('muxmap-claude-completed', 'claude', { hook_event_name: 'Notification', notification_type: 'idle_prompt' }, 'read', '2026-08-07T10:01:00.000Z')
    first.upsertAgentActivity('muxmap-claude-completed', { kind: 'claude', state: 'read', since: '2026-08-07T10:01:00.000Z' })

    first.recordAgentEvent('muxmap-claude-permission', 'claude', { hook_event_name: 'PermissionRequest' }, 'needs_input', '2026-08-07T10:02:00.000Z')
    first.recordAgentEvent('muxmap-claude-permission', 'claude', { payload: { hookEventName: 'PreToolUse' } }, 'working', '2026-08-07T10:03:00.000Z')
    first.upsertAgentActivity('muxmap-claude-permission', { kind: 'claude', state: 'needs_input', since: '2026-08-07T10:02:00.000Z' })

    first.recordAgentEvent('muxmap-manual-working', 'codex', { type: 'manual_status', state: 'working' }, 'working', '2026-08-07T10:04:00.000Z')
    first.recordAgentEvent('muxmap-manual-working', 'codex', { hook_event_name: 'Stop' }, 'completed', '2026-08-07T10:05:00.000Z')
    first.upsertAgentActivity('muxmap-manual-working', { kind: 'codex', state: 'working', since: '2026-08-07T10:04:00.000Z' })

    first.recordAgentEvent('muxmap-claude-delegated', 'claude', { hook_event_name: 'Stop', background_tasks: [{ id: 'task-1', description: 'Run mvn test' }] }, 'delegated', '2026-08-07T10:06:00.000Z')
    first.upsertAgentActivity('muxmap-claude-delegated', { kind: 'claude', state: 'working', since: '2026-08-07T10:06:00.000Z' })

    first.recordAgentEvent('muxmap-claude-delegated-cleared', 'claude', { hook_event_name: 'Stop', background_tasks: [{ id: 'task-1' }] }, 'delegated', '2026-08-07T10:07:00.000Z')
    first.recordAgentEvent('muxmap-claude-delegated-cleared', 'claude', { hook_event_name: 'Stop', background_tasks: [], session_crons: [] }, 'completed', '2026-08-07T10:08:00.000Z')
    first.upsertAgentActivity('muxmap-claude-delegated-cleared', { kind: 'claude', state: 'delegated', since: '2026-08-07T10:07:00.000Z' })
    first.close()

    const rebuilt = createStore(database)
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-completed')?.state, 'completed')
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-completed')?.since, '2026-08-07T10:00:00.000Z')
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-permission')?.state, 'working')
    assert.equal(rebuilt.getAgentActivity('muxmap-manual-working')?.state, 'completed')
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-delegated')?.state, 'delegated')
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-delegated')?.since, '2026-08-07T10:06:00.000Z')
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-delegated-cleared')?.state, 'completed')
    assert.equal(rebuilt.getAgentActivity('muxmap-claude-delegated-cleared')?.since, '2026-08-07T10:08:00.000Z')
    rebuilt.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('terminal activity persists and legacy sessions fall back to their last attachment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-activity-migration-'))
  const database = join(directory, 'muxmap.db')
  const attachedAt = '2026-08-07T09:00:00.000Z'

  try {
    const first = createStore(database)
    const node = first.createNode('default', { parentId: 'workspace', title: 'Active shell', type: 'terminal' })
    const session = first.upsertSession({
      id: 'activity-session', workspaceId: 'default', nodeId: node.id, name: 'tmux:activity', runtimeName: 'muxmap-activity',
      backend: 'tmux', cwd: process.cwd(), status: 'running', lastAttachedAt: attachedAt,
    })
    first.close()

    const legacy = new DatabaseSync(database)
    legacy.exec('ALTER TABLE sessions DROP COLUMN last_activity_at')
    legacy.close()

    const migrated = createStore(database)
    assert.equal(migrated.getSession(session.id)?.lastActivityAt, attachedAt)
    migrated.updateSessionActivity(session.id, '2026-08-11T12:00:00.000Z')
    migrated.close()

    const reopened = createStore(database)
    assert.equal(reopened.getSession(session.id)?.lastActivityAt, '2026-08-11T12:00:00.000Z')
    reopened.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('agent channels connect two terminal-backed nodes and persist MCP metadata', () => {
  const store = createStore(':memory:')
  const first = store.createNode('default', { parentId: 'workspace', title: 'Agent A', type: 'terminal' })
  const second = store.createNode('default', { parentId: 'workspace', title: 'Agent B', type: 'terminal' })
  const plain = store.createNode('default', { parentId: 'workspace', title: 'Plain note', type: 'note' })
  store.upsertSession({ id: 'sess-a', workspaceId: 'default', nodeId: first.id, name: 'tmux:a', runtimeName: 'muxmap-a', backend: 'tmux', cwd: process.cwd(), status: 'running' })
  store.upsertSession({ id: 'sess-b', workspaceId: 'default', nodeId: second.id, name: 'tmux:b', runtimeName: 'muxmap-b', backend: 'tmux', cwd: process.cwd(), status: 'running' })

  assert.throws(() => store.createAgentChannel('default', { sourceNodeId: first.id, targetNodeId: plain.id }), /terminal sessions/)

  const channel = store.createAgentChannel('default', { sourceNodeId: first.id, targetNodeId: second.id })
  assert.equal(channel.title, `${first.title} ↔ ${second.title}`)
  assert.match(channel.mcpUri, /^muxmap:\/\/agent-channels\//)
  assert.equal(store.createAgentChannel('default', { sourceNodeId: second.id, targetNodeId: first.id }).id, channel.id)
  assert.equal(store.getWorkspace('default').channels?.length, 1)

  const message = store.createAgentChannelMessage(channel.id, { authorNodeId: first.id, body: 'Please inspect the failing test.' })
  assert.equal(message.body, 'Please inspect the failing test.')
  assert.equal(store.listAgentChannelMessages(channel.id)[0]?.authorNodeId, first.id)
  assert.throws(() => store.createAgentChannelMessage(channel.id, { authorNodeId: plain.id, body: 'intrude' }), /author/)

  store.deleteAgentChannel(channel.id)
  assert.equal(store.getWorkspace('default').channels?.length, 0)
  store.close()
})

test('agent channels expose Claude cross-session routing without storing messaging tokens', () => {
  const store = createStore(':memory:')
  const first = store.createNode('default', { parentId: 'workspace', title: 'Claude A', type: 'terminal' })
  const second = store.createNode('default', { parentId: 'workspace', title: 'Claude B', type: 'terminal' })
  store.upsertSession({ id: 'sess-a', workspaceId: 'default', nodeId: first.id, name: 'tmux:a', runtimeName: 'muxmap-a', backend: 'tmux', cwd: '/repo/a', status: 'running' })
  store.upsertSession({ id: 'sess-b', workspaceId: 'default', nodeId: second.id, name: 'tmux:b', runtimeName: 'muxmap-b', backend: 'tmux', cwd: '/repo/b', status: 'running' })
  store.upsertAgentActivity('muxmap-a', { kind: 'claude', state: 'working', since: '2026-08-07T10:00:00.000Z', externalSessionId: 'claude-a', messagingProtocol: 'claude-cross-session', messagingSocket: 'uds:/tmp/claude-a.sock' })
  store.upsertAgentActivity('muxmap-b', { kind: 'claude', state: 'read', since: '2026-08-07T10:00:00.000Z', externalSessionId: 'claude-b', messagingProtocol: 'claude-cross-session', messagingSocket: 'uds:/tmp/claude-b.sock' })

  const channel = store.createAgentChannel('default', { sourceNodeId: first.id, targetNodeId: second.id })

  assert.equal(channel.transport, 'claude-cross-session-ready')
  assert.equal(channel.deliveryPolicy, 'human-gated')
  assert.equal(channel.messageLimit, 50)
  assert.equal(channel.tokenWarningPerHour, 250000)
  assert.equal(channel.tokenHardStopPerHour, 500000)
  assert.equal(channel.sourceRoute.protocol, 'claude-cross-session')
  assert.equal(channel.sourceRoute.address, 'uds:/tmp/claude-a.sock')
  assert.equal(channel.sourceRoute.externalSessionId, 'claude-a')
  assert.equal(JSON.stringify(channel).includes('token'), true)
  assert.equal(JSON.stringify(channel).includes('secret'), false)
  store.close()
})

test('agent channel messages enforce a one-hour sliding quota before closing noisy channels', () => {
  const store = createStore(':memory:')
  const first = store.createNode('default', { parentId: 'workspace', title: 'Agent A', type: 'terminal' })
  const second = store.createNode('default', { parentId: 'workspace', title: 'Agent B', type: 'terminal' })
  store.upsertSession({ id: 'sess-a', workspaceId: 'default', nodeId: first.id, name: 'tmux:a', runtimeName: 'muxmap-a', backend: 'tmux', cwd: process.cwd(), status: 'running' })
  store.upsertSession({ id: 'sess-b', workspaceId: 'default', nodeId: second.id, name: 'tmux:b', runtimeName: 'muxmap-b', backend: 'tmux', cwd: process.cwd(), status: 'running' })
  const channel = store.createAgentChannel('default', { sourceNodeId: first.id, targetNodeId: second.id })
  const big = 'x'.repeat(4000)

  for (let index = 0; index < 49; index += 1) {
    store.createAgentChannelMessage(channel.id, { authorNodeId: first.id, body: `message-${index}`, createdAt: '2026-08-07T10:00:00.000Z' })
  }
  assert.equal(store.getAgentChannelUsage(channel.id, '2026-08-07T10:30:00.000Z').messageCount, 49)
  store.createAgentChannelMessage(channel.id, { authorNodeId: second.id, body: 'last allowed', createdAt: '2026-08-07T10:31:00.000Z' })
  assert.throws(() => store.createAgentChannelMessage(channel.id, { authorNodeId: first.id, body: 'one too many', createdAt: '2026-08-07T10:32:00.000Z' }), /hourly message limit/)

  const reopened = store.createAgentChannel('default', { sourceNodeId: first.id, targetNodeId: second.id, title: 'Quota after window' })
  assert.notEqual(reopened.id, channel.id)
  store.createAgentChannelMessage(reopened.id, { authorNodeId: first.id, body: big, tokenCount: 250001, createdAt: '2026-08-07T12:00:00.000Z' })
  assert.equal(store.getAgentChannelUsage(reopened.id, '2026-08-07T12:30:00.000Z').warning, true)
  assert.throws(() => store.createAgentChannelMessage(reopened.id, { authorNodeId: second.id, body: big, tokenCount: 250000, createdAt: '2026-08-07T12:31:00.000Z' }), /hourly token limit/)
  assert.equal(store.getAgentChannel(reopened.id)?.status, 'closed')
  store.close()
})

test('terminal input history is stored per session without duplicate consecutive entries', () => {
  const store = createStore(':memory:')
  const node = store.createNode('default', { parentId: 'workspace', title: 'Command terminal', type: 'terminal' })
  store.upsertSession({ id: 'sess-command', workspaceId: 'default', nodeId: node.id, name: 'tmux:command', runtimeName: 'muxmap-command', backend: 'tmux', cwd: process.cwd(), status: 'running' })

  const first = store.recordTerminalInput('sess-command', 'bun run test')
  const duplicate = store.recordTerminalInput('sess-command', 'bun run test')
  const second = store.recordTerminalInput('sess-command', 'git status')

  assert.equal(duplicate.id, first.id)
  assert.deepEqual(store.listTerminalInputHistory('sess-command').map((item) => item.value), ['git status', 'bun run test'])
  assert.equal(store.listTerminalInputHistory('sess-command')[0]?.runtimeName, 'muxmap-command')
  assert.ok(Date.parse(second.createdAt))
  store.close()
})

test('node creation validates hierarchy and input', () => {
  const store = createStore(':memory:')
  assert.throws(() => store.createNode('default', {
    parentId: 'missing',
    title: 'No parent',
    type: 'note',
  }), /parent/i)
  assert.throws(() => store.createNode('default', {
    parentId: 'workspace',
    title: '  ',
    type: 'note',
  }), /title/i)
  store.close()
})

test('node title, type, and metadata can be edited without changing its hierarchy', () => {
  const store = createStore(':memory:')
  const node = store.createNode('default', {
    parentId: 'workspace',
    title: 'New node',
    type: 'note',
  })

  const updated = store.updateNode(node.id, {
    title: 'Release checklist',
    type: 'todo',
    project: 'Platform',
    note: 'Run before deploy',
  })

  assert.equal(updated.title, 'Release checklist')
  assert.equal(updated.type, 'todo')
  assert.equal(updated.project, 'Platform')
  assert.equal(updated.note, 'Run before deploy')
  assert.equal(updated.parentId, 'workspace')
  const done = store.updateNode(node.id, { doneAt: '2026-08-19T12:00:00.000Z' })
  assert.equal(done.doneAt, '2026-08-19T12:00:00.000Z')
  assert.equal(store.updateNode(node.id, { doneAt: '' }).doneAt, undefined)
  assert.throws(() => store.updateNode(node.id, { title: '   ' }), /title/i)
  store.close()
})

test('children inherit node color and can override it independently', () => {
  const store = createStore(':memory:')
  const parent = store.createNode('default', { parentId: 'workspace', title: 'Parent', type: 'note', color: '#123456' })
  const child = store.createNode('default', { parentId: parent.id, title: 'Child', type: 'note' })
  assert.equal(child.color, '#123456')
  assert.equal(store.updateNode(child.id, { color: '#abcdef' }).color, '#abcdef')
  assert.equal(store.getNode(parent.id)?.color, '#123456')
  store.close()
})

test('sibling order can change without changing hierarchy', () => {
  const store = createStore(':memory:')
  const group = store.createNode('default', { parentId: 'workspace', title: 'Group', type: 'note' })
  const first = store.createNode('default', { parentId: group.id, title: 'First', type: 'note' })
  const second = store.createNode('default', { parentId: group.id, title: 'Second', type: 'note' })
  const third = store.createNode('default', { parentId: group.id, title: 'Third', type: 'note' })
  const nested = store.createNode('default', { parentId: first.id, title: 'Nested', type: 'note' })

  assert.deepEqual(store.reorderNode(third.id, second.id, 'before').map((node) => node.id), [first.id, third.id, second.id])
  assert.equal(store.getNode(third.id)?.parentId, group.id)
  assert.throws(() => store.reorderNode(nested.id, second.id, 'before'), /siblings/i)
  store.close()
})

test('deleting a node removes its branch records but never the workspace root', () => {
  const store = createStore(':memory:')
  const parent = store.createNode('default', { parentId: 'workspace', title: 'Branch', type: 'note' })
  const child = store.createNode('default', { parentId: parent.id, title: 'Leaf', type: 'note' })
  assert.deepEqual(store.deleteNode(parent.id).sort(), [child.id, parent.id].sort())
  assert.equal(store.getNode(parent.id), undefined)
  assert.equal(store.getNode(child.id), undefined)
  assert.throws(() => store.deleteNode('workspace'), /root/i)
  store.close()
})

test('archive state persists without changing parent relationships', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-archive-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    const parent = first.createNode('default', { parentId: 'workspace', title: 'Finished project', type: 'feature' })
    const child = first.createNode('default', { parentId: parent.id, title: 'Still nested', type: 'note' })
    const archivedParent = first.archiveNode(parent.id)
    assert.ok(archivedParent.archivedAt)
    assert.equal(first.getNode(child.id)?.archivedAt, undefined)
    assert.equal(first.getNode(child.id)?.parentId, parent.id)

    first.archiveNode(child.id)
    first.restoreNode(parent.id)
    assert.equal(first.getNode(parent.id)?.archivedAt, undefined)
    assert.ok(first.getNode(child.id)?.archivedAt, 'an independently archived child stays archived')
    assert.throws(() => first.archiveNode('workspace'), /root/i)
    first.close()

    const second = createStore(database)
    assert.equal(second.getNode(child.id)?.parentId, parent.id)
    assert.ok(second.getNode(child.id)?.archivedAt)
    second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('existing databases gain archive support without losing nodes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-archive-migration-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    const existing = first.createNode('default', { parentId: 'workspace', title: 'Existing work', type: 'note' })
    first.close()
    const legacy = new DatabaseSync(database)
    legacy.exec('ALTER TABLE nodes DROP COLUMN archived_at')
    legacy.close()

    const migrated = createStore(database)
    assert.equal(migrated.getNode(existing.id)?.title, 'Existing work')
    assert.ok(migrated.archiveNode(existing.id).archivedAt)
    migrated.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
