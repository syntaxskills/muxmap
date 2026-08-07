import assert from 'node:assert/strict'
import test from 'node:test'
import { contextMenuPosition, duplicateNodeInput } from './nodeContextMenu.ts'
import type { WorkNode } from './model.ts'

const node: WorkNode = {
  id: 'ticket',
  workspaceId: 'default',
  parentId: 'feature',
  title: 'Investigate timeout',
  type: 'ticket',
  project: 'Runtime',
  color: '#4f86c6',
  repoPath: '/repo/runtime',
  jiraKey: 'DEV-42',
  note: 'Reproduce before changing retries.',
  sortOrder: 3,
  createdAt: 'created',
  updatedAt: 'updated',
}

test('duplicating a node copies editable metadata but no identity or runtime state', () => {
  assert.deepEqual(duplicateNodeInput(node), {
    parentId: 'feature',
    title: 'Investigate timeout copy',
    type: 'ticket',
    project: 'Runtime',
    color: '#4f86c6',
    repoPath: '/repo/runtime',
    jiraKey: 'DEV-42',
    note: 'Reproduce before changing retries.',
  })
  assert.equal(duplicateNodeInput({ ...node, parentId: null }), null)
})

test('context menus stay inside the viewport margin', () => {
  assert.deepEqual(contextMenuPosition(900, 700, 1000, 800), { x: 792, y: 572 })
  assert.deepEqual(contextMenuPosition(-20, -30, 1000, 800), { x: 8, y: 8 })
})
