import assert from 'node:assert/strict'
import test from 'node:test'
import { dragIntent, dropPositionAt, nodeDropTarget, pointerReleaseIntent } from './nodeReorderInteraction.ts'
import type { WorkNode } from './model.ts'

test('node centers accept a new child, sibling edges reorder, and invalid parents have no preview', () => {
  const nodes: WorkNode[] = [
    ['root', null], ['a', 'root'], ['b', 'root'], ['child', 'a'], ['grandchild', 'child'],
  ].map(([id, parentId]) => ({ id: id!, parentId, workspaceId: 'default', title: id!, type: 'note', color: '#fff', sortOrder: 0, createdAt: '', updatedAt: '' }))
  nodes.push({ ...nodes[2], id: 'foreign', workspaceId: 'another-workspace', parentId: null })
  const bounds = { top: 100, height: 80 }
  assert.deepEqual(nodeDropTarget(nodes, 'a', 'b', 140, bounds), { id: 'b', position: 'inside' })
  assert.deepEqual(nodeDropTarget(nodes, 'a', 'b', 110, bounds), { id: 'b', position: 'before' })
  assert.deepEqual(nodeDropTarget(nodes, 'a', 'b', 170, bounds), { id: 'b', position: 'after' })
  assert.deepEqual(nodeDropTarget(nodes, 'child', 'b', 110, bounds), { id: 'b', position: 'inside' })
  assert.deepEqual(nodeDropTarget(nodes, 'child', 'root', 140, bounds), { id: 'root', position: 'inside' })
  for (const target of ['a', 'child', 'grandchild', 'root', 'missing', 'foreign']) {
    assert.equal(nodeDropTarget(nodes, 'a', target, 140, bounds), null)
  }
  assert.equal(nodeDropTarget(nodes, 'root', 'b', 140, bounds), null)
})

test('node pointer gestures distinguish clicks from vertical reorder drags', () => {
  assert.equal(dragIntent({ x: 20, y: 20 }, { x: 23, y: 24 }), false)
  assert.equal(dragIntent({ x: 20, y: 20 }, { x: 20, y: 27 }), true)
  assert.equal(dropPositionAt(109, { top: 100, height: 42 }), 'before')
  assert.equal(dropPositionAt(133, { top: 100, height: 42 }), 'after')
})

test('releasing anywhere inside an expanded node activates it unless a reorder occurred', () => {
  assert.equal(pointerReleaseIntent(false, false), 'activate')
  assert.equal(pointerReleaseIntent(true, true), 'reorder')
  assert.equal(pointerReleaseIntent(true, false), 'none')
})
