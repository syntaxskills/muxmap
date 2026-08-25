import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clampMenuPosition, contextMenuConfirmationText, duplicateNodeInput } from './nodeContextMenu.ts'
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

test('context menu clamp keeps a fitting menu at the click point', () => {
  assert.deepEqual(clampMenuPosition(120, 140, 200, 220, 1000, 800), { x: 120, y: 140 })
})

test('context menu clamp flips upward when it overflows the bottom edge', () => {
  assert.deepEqual(clampMenuPosition(120, 700, 200, 220, 1000, 800), { x: 120, y: 480 })
})

test('context menu clamp moves left when it overflows the right edge', () => {
  assert.deepEqual(clampMenuPosition(900, 140, 200, 220, 1000, 800), { x: 792, y: 140 })
})

test('context menu clamp adjusts both axes near the bottom-right corner', () => {
  assert.deepEqual(clampMenuPosition(980, 790, 200, 220, 1000, 800), { x: 792, y: 570 })
})

test('context menu clamp never returns negative coordinates', () => {
  assert.deepEqual(clampMenuPosition(6, 12, 200, 220, 160, 180), { x: 8, y: 8 })
})

test('node context menu uses measured fixed positioning instead of Floating UI', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(app, /useLayoutEffect\(\(\) => \{[\s\S]*clampMenuPosition/)
  assert.match(app, /ref=\{contextMenuRef\}/)
  assert.match(app, /style=\{\{ left: menuPosition\.x, top: menuPosition\.y \}\}/)
  assert.doesNotMatch(app, /contextMenuFloating/)
  assert.doesNotMatch(app, /setPositionReference/)
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
