import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { contextMenuConfirmationText, contextMenuPosition, duplicateNodeInput } from './nodeContextMenu.ts'
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

test('node context menu is positioned by Floating UI from the click point', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(app, /useFloating\(\{[\s\S]*placement:\s*'bottom-start'[\s\S]*shift\(\{\s*padding:\s*8\s*\}\)/)
  assert.match(app, /setPositionReference\(\{[\s\S]*getBoundingClientRect/)
  assert.match(app, /ref=\{contextMenuFloating\.refs\.setFloating\}/)
  assert.doesNotMatch(app, /style=\{\{ left: contextMenu\.x, top: contextMenu\.y \}\}/)
})

test('context menu destructive actions confirm in place', () => {
  assert.equal(contextMenuConfirmationText('archive', false), 'Confirm archive?')
  assert.equal(contextMenuConfirmationText('delete', false), 'Confirm delete?')
  assert.equal(contextMenuConfirmationText('delete', true), 'Confirm delete and stop session')
})

test('context menu delete confirmation is one action when sessions are present', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(app, /is-secondary-confirm/)
  assert.doesNotMatch(app, /Stop sessions too/)
  assert.match(app, /deleteNode\(node\.id, branchHasSession\)/)
})
