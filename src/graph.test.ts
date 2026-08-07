import assert from 'node:assert/strict'
import test from 'node:test'
import { branchHasLiveSession, expandedNodeHeight, liveSessionIdForNode, reorderSiblings, visibleNodes } from './graph.ts'
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
    { id: 'stopped', nodeId: 'b', status: 'stopped' },
  ]
  assert.equal(liveSessionIdForNode(sessions, 'a'), 'running')
  assert.equal(liveSessionIdForNode(sessions, 'b'), null)
  assert.equal(liveSessionIdForNode(sessions, 'c'), null)
})

test('delete choices mention tmux only when the branch contains a live session', () => {
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'ticket', status: 'running' }], 'repo'), true)
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'ticket', status: 'stopped' }], 'repo'), false)
  assert.equal(branchHasLiveSession(nodes, [{ nodeId: 'other', status: 'running' }], 'repo'), false)
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
  assert.equal(expandedNodeHeight({ ...nodes[3], project: 'Identity', repoPath: '/repo', note: 'Context' }, true), 136)
})
