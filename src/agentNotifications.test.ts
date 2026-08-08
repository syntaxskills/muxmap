import assert from 'node:assert/strict'
import test from 'node:test'
import { scanAgentNotifications } from './agentNotifications.ts'
import type { WorkspaceGraph } from './model.ts'

function graph(state: 'working' | 'needs_input' | 'completed' | 'read', since: string): WorkspaceGraph {
  return {
    workspace: { id: 'default', name: 'Test', rootNodeId: 'root', createdAt: '', updatedAt: '' },
    nodes: [
      { id: 'root', workspaceId: 'default', parentId: null, title: 'Workspace', type: 'workspace', color: '#fff', sortOrder: 0, createdAt: '', updatedAt: '' },
      { id: 'task', workspaceId: 'default', parentId: 'root', title: 'Release task', type: 'terminal', color: '#fff', sortOrder: 0, createdAt: '', updatedAt: '' },
    ],
    sessions: [{
      id: 'session', workspaceId: 'default', nodeId: 'task', name: 'tmux:task', runtimeName: 'muxmap-task', backend: 'tmux', cwd: '/repo', status: 'running', createdAt: '', updatedAt: '',
      agent: { kind: 'claude', state, since },
    }],
  }
}

test('agent notifications emit once per completion or input event and retain terminal routing', () => {
  const baseline = scanAgentNotifications(graph('completed', '10:00'), new Map(), false)
  assert.deepEqual(baseline.notifications, [])
  assert.deepEqual(scanAgentNotifications(graph('completed', '10:00'), baseline.notified).notifications, [])

  const input = scanAgentNotifications(graph('needs_input', '10:05'), baseline.notified)
  assert.deepEqual(input.notifications, [{
    key: 'needs_input:10:05',
    sessionId: 'session',
    nodeId: 'task',
    title: 'Claude Code needs input',
    body: 'Release task',
  }])
  assert.deepEqual(scanAgentNotifications(graph('needs_input', '10:05'), input.notified).notifications, [])

  const completed = scanAgentNotifications(graph('completed', '10:10'), input.notified)
  assert.equal(completed.notifications[0]?.title, 'Claude Code completed')
  assert.deepEqual(scanAgentNotifications(graph('read', '10:10'), completed.notified).notifications, [])
  assert.deepEqual(scanAgentNotifications(graph('completed', '10:10'), completed.notified).notifications, [])
})
