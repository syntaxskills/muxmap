import assert from 'node:assert/strict'
import test from 'node:test'
import { activeNodes, archivedDirectChildren, archivedNodeEntries, branchHasLiveSession, canRecoverAgentSession, canRecoverCodexSession, effectiveArchivedNodeIds, expandedNodeHeight, liveSessionIdForNode, nodeHasLiveSession, recoverableAgentLabel, reorderSiblings, visibleAgentForSession, visibleNodes } from './graph.ts'
import type { WorkNode } from './model.ts'

const base = {
  workspaceId: 'default',
  color: '#fff',
  sortOrder: 0,
  createdAt: '',
  updatedAt: '',
}

const nodes: WorkNode[] = [
  { ...base, id: 'root', parentId: null, title: 'Workspace', type: 'workspace' },
  { ...base, id: 'repo', parentId: 'root', title: 'Users', type: 'repo' },
  { ...base, id: 'feature', parentId: 'repo', title: 'Device trust', type: 'feature' },
  { ...base, id: 'ticket', parentId: 'feature', title: 'Session expiry', type: 'ticket', jiraKey: 'DEV-1420' },
  { ...base, id: 'other', parentId: 'root', title: 'Compliance', type: 'repo', sortOrder: 1 },
]

test('collapse hides descendants and search retains matching ancestors', () => {
  assert.deepEqual(visibleNodes(nodes, new Set(['repo']), '').map((node) => node.id), ['root', 'repo', 'other'])
  assert.deepEqual(visibleNodes(nodes, new Set(), 'dev-1420').map((node) => node.id), ['root', 'repo', 'feature', 'ticket'])
  assert.deepEqual(visibleNodes(nodes, new Set(['repo']), 'dev-1420').map((node) => node.id), ['root', 'repo', 'feature', 'ticket'])
})

test('node selection opens only its live terminal and otherwise minimizes the current one', () => {
  const sessions = [
    { id: 'running', nodeId: 'a', status: 'running' },
    { id: 'missing', nodeId: 'missing', status: 'running', runtimeExists: false },
    { id: 'stopped', nodeId: 'b', status: 'stopped' },
    { id: 'suspended', nodeId: 'suspended', status: 'suspended' },
  ]
  assert.equal(liveSessionIdForNode(sessions, 'a'), 'running')
  assert.equal(liveSessionIdForNode(sessions, 'missing'), null)
  assert.equal(liveSessionIdForNode(sessions, 'b'), null)
  assert.equal(liveSessionIdForNode(sessions, 'suspended'), null)
  assert.equal(liveSessionIdForNode(sessions, 'c'), null)
  assert.equal(nodeHasLiveSession({ status: 'suspended' }), false)
})

test('delete choices mention tmux only when the branch contains a live session', () => {
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'ticket', status: 'running' }], 'repo'), true)
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'ticket', status: 'running', runtimeExists: false }], 'repo'), false)
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'ticket', status: 'stopped' }], 'repo'), false)
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'ticket', status: 'suspended' }], 'repo'), false)
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'other', status: 'running' }], 'repo'), false)
  const archived = nodes.map((node) => node.id === 'repo' ? { ...node, archivedAt: '2026-08-11T00:00:00.000Z' } : node)
  assert.equal(branchHasLiveSession(archived, [{ nodeId: 'ticket', status: 'detached' }], 'repo'), true)
})

test('Codex recovery is based on missing runtime and a saved Codex session id', () => {
  const missingWorking = {
    backend: 'tmux',
    status: 'running',
    runtimeExists: false,
    agent: { kind: 'codex', externalSessionId: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' },
  }
  assert.equal(canRecoverCodexSession(missingWorking), true)
  assert.equal(visibleAgentForSession(missingWorking), undefined)
  assert.equal(canRecoverCodexSession({
    backend: 'tmux',
    status: 'stopped',
    agent: { kind: 'codex', externalSessionId: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' },
  }), true)
  assert.equal(canRecoverCodexSession({
    backend: 'tmux',
    status: 'running',
    runtimeExists: true,
    agent: { kind: 'codex', externalSessionId: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' },
  }), false)
  assert.deepEqual(visibleAgentForSession({
    backend: 'tmux',
    status: 'running',
    runtimeExists: true,
    agent: { kind: 'codex', state: 'working' },
  }), { kind: 'codex', state: 'working' })
})

test('agent recovery supports Claude and Pi metadata on missing tmux runtimes', () => {
  assert.equal(canRecoverAgentSession({
    backend: 'tmux',
    status: 'stopped',
    agent: { kind: 'claude', externalSessionId: 'claude-session' },
  }), true)
  assert.equal(canRecoverAgentSession({
    backend: 'tmux',
    status: 'running',
    runtimeExists: false,
    agent: { kind: 'pi', externalSessionPath: '/home/me/.pi/agent/sessions/task.jsonl' },
  }), true)
  assert.equal(canRecoverAgentSession({
    backend: 'tmux',
    status: 'stopped',
    agent: { kind: 'pi' },
  }), false)
  assert.equal(recoverableAgentLabel({ backend: 'tmux', status: 'stopped', agent: { kind: 'claude' } }), 'Claude Code')
  assert.equal(recoverableAgentLabel({ backend: 'tmux', status: 'stopped', agent: { kind: 'pi' } }), 'Pi')
})

test('reordering moves nodes only within their existing sibling group', () => {
  const nodes: WorkNode[] = [
    { ...base, id: 'root', parentId: null, title: 'Root', type: 'workspace' },
    { ...base, id: 'one', parentId: 'root', title: 'One', type: 'note', sortOrder: 0 },
    { ...base, id: 'two', parentId: 'root', title: 'Two', type: 'note', sortOrder: 1 },
    { ...base, id: 'three', parentId: 'root', title: 'Three', type: 'note', sortOrder: 2 },
    { ...base, id: 'nested', parentId: 'one', title: 'Nested', type: 'note', sortOrder: 0 },
  ]
  const reordered = reorderSiblings(nodes, 'three', 'two', 'before')
  assert.deepEqual(reordered.filter((node) => node.parentId === 'root').sort((a, b) => a.sortOrder - b.sortOrder).map((node) => node.id), ['one', 'three', 'two'])
  assert.equal(reorderSiblings(nodes, 'nested', 'two', 'before'), nodes)
})

test('expanded nodes grow only as much as their visible metadata needs', () => {
  assert.equal(expandedNodeHeight(nodes[1], false), 106)
  assert.equal(expandedNodeHeight({ ...nodes[1], type: 'todo' }, false), 106)
  assert.equal(expandedNodeHeight({ ...nodes[3], project: 'Identity', repoPath: '/repo', note: 'Context' }, true), 142)
  assert.equal(expandedNodeHeight({ ...nodes[3], type: 'todo', project: 'Identity', repoPath: '/repo', note: 'Context' }, true, 0, true), 155)
  assert.equal(expandedNodeHeight({ ...nodes[3], project: 'Identity', repoPath: '/repo', note: 'Context' }, false, 1), 142)
  assert.equal(expandedNodeHeight({ ...nodes[3], repoPath: '/very/long/path/that/needs/to/wrap/because/it/would/overflow/the/expanded/node', note: 'Long notes should add height instead of spilling outside the node card.' }, false), 129)
})

test('an archived node remains discoverable directly inside its original parent', () => {
  const archived = nodes.map((node) => node.id === 'ticket' ? { ...node, archivedAt: '2026-08-09T02:00:00.000Z' } : node)
  assert.deepEqual(archivedDirectChildren(archived, 'feature').map((node) => node.id), ['ticket'])
  assert.deepEqual(archivedDirectChildren(archived, 'repo'), [])
  assert.equal(archivedNodeEntries(archived, '')[0].path, 'Users / Device trust / Session expiry')
})

test('archiving a parent hides its branch while preserving the original hierarchy', () => {
  const archived = nodes.map((node) => node.id === 'repo' ? { ...node, archivedAt: '2026-08-09T02:00:00.000Z' } : node)
  assert.deepEqual([...effectiveArchivedNodeIds(archived)], ['repo', 'feature', 'ticket'])
  assert.deepEqual(activeNodes(archived).map((node) => node.id), ['root', 'other'])

  const entries = archivedNodeEntries(archived, '')
  assert.deepEqual(entries.map((entry) => [entry.node.id, entry.depth, entry.inherited]), [
    ['repo', 0, false],
    ['feature', 1, true],
    ['ticket', 2, true],
  ])
  assert.equal(entries[2].path, 'Users / Device trust / Session expiry')
})

test('archive search retains archived ancestors for context', () => {
  const archived = nodes.map((node) => node.id === 'repo' ? { ...node, archivedAt: '2026-08-09T02:00:00.000Z' } : node)
  assert.deepEqual(archivedNodeEntries(archived, 'DEV-1420').map((entry) => entry.node.id), ['repo', 'feature', 'ticket'])
  assert.deepEqual(archivedNodeEntries(archived, 'missing'), [])
})

test('archiving a parent keeps an explicitly archived child nested only once', () => {
  const archived = nodes.map((node) => ['feature', 'ticket'].includes(node.id) ? { ...node, archivedAt: '2026-08-09T02:00:00.000Z' } : node)
  assert.deepEqual(archivedNodeEntries(archived, '').map((entry) => [entry.node.id, entry.depth, entry.inherited]), [
    ['feature', 0, false],
    ['ticket', 1, true],
  ])
})
