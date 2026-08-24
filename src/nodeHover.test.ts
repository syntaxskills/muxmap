import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  clearHoveredNodeAfterGrace,
  NODE_HOVER_LEAVE_GRACE_MS,
  nodeUsesExpandedLayout,
  nodeUsesExpandedRender,
} from './nodeHover.ts'

test('node hover leave grace only clears the node that actually left', () => {
  assert.equal(NODE_HOVER_LEAVE_GRACE_MS, 150)
  assert.equal(clearHoveredNodeAfterGrace('node-1', 'node-1'), null)
  assert.equal(clearHoveredNodeAfterGrace('node-2', 'node-1'), 'node-2')
  assert.equal(clearHoveredNodeAfterGrace(null, 'node-1'), null)
})

test('hover expansion renders visually but does not participate in layout', () => {
  assert.equal(nodeUsesExpandedLayout('node-1', 'node-1'), true)
  assert.equal(nodeUsesExpandedLayout('node-1', 'node-2'), false)
  assert.equal(nodeUsesExpandedRender('node-1', 'node-2', 'node-1'), true)
  assert.equal(nodeUsesExpandedRender('node-1', 'node-1', null), true)

  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(app, /\.filter\(\(node\) => nodeUsesExpandedLayout\(node\.id, selectedId\)\)/)
  assert.match(app, /const expanded = nodeUsesExpandedRender\(node\.id, selectedId, hoveredId\)/)
  assert.match(app, /const renderHeight = expanded[\s\S]*expandedNodeHeight/)
})
