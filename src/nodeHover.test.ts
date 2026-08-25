import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  clearHoveredNodeAfterGrace,
  containsPoint,
  inflateRect,
  NODE_HOVER_LEAVE_GRACE_MS,
  nodeUsesExpandedLayout,
} from './nodeHover.ts'

test('node hover leave grace only clears the node that actually left', () => {
  assert.equal(NODE_HOVER_LEAVE_GRACE_MS, 150)
  assert.equal(clearHoveredNodeAfterGrace('node-1', 'node-1'), null)
  assert.equal(clearHoveredNodeAfterGrace('node-2', 'node-1'), 'node-2')
  assert.equal(clearHoveredNodeAfterGrace(null, 'node-1'), null)
})

test('hover expansion participates in layout like selection', () => {
  assert.equal(nodeUsesExpandedLayout('node-1', 'node-1', null), true)
  assert.equal(nodeUsesExpandedLayout('node-1', 'node-2', 'node-1'), true)
  assert.equal(nodeUsesExpandedLayout('node-1', 'node-2', 'node-3'), false)

  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.match(app, /\.filter\(\(node\) => nodeUsesExpandedLayout\(node\.id, selectedId, hoveredId\)\)/)
  assert.match(app, /const expanded = nodeUsesExpandedLayout\(node\.id, selectedId, hoveredId\)/)
  assert.match(app, /height: nodeHeights\.get\(node\.id\) \?\? NODE_HEIGHT/)
  assert.doesNotMatch(app, /const renderHeight = expanded[\s\S]*expandedNodeHeight/)
})

test('inflated hover rect contains inside, edge, and margin boundary points', () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 80 }
  const inflated = inflateRect(rect, 40)

  assert.deepEqual(inflated, { left: -30, top: -20, right: 150, bottom: 120 })
  assert.equal(containsPoint(inflated, { x: 50, y: 50 }), true)
  assert.equal(containsPoint(inflated, { x: 10, y: 20 }), true)
  assert.equal(containsPoint(inflated, { x: -30, y: 120 }), true)
  assert.equal(containsPoint(inflated, { x: -31, y: 50 }), false)
  assert.equal(containsPoint(inflated, { x: 50, y: 121 }), false)
})
