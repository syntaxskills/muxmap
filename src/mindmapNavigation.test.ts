import assert from 'node:assert/strict'
import test from 'node:test'
import { blocksMindmapKeyboardNavigation, mindmapDirectionFromKey, navigateMindmapNode } from './mindmapNavigation.ts'
import type { WorkNode } from './model.ts'

function node(id: string, sortOrder: number): WorkNode {
  return {
    id,
    workspaceId: 'workspace',
    parentId: id === 'root' ? null : 'root',
    title: id,
    type: id === 'root' ? 'workspace' : 'note',
    color: '#7da079',
    sortOrder,
    createdAt: `2026-08-19T00:00:0${sortOrder}.000Z`,
    updatedAt: `2026-08-19T00:00:0${sortOrder}.000Z`,
  }
}

test('arrow keys map to mindmap navigation directions', () => {
  assert.equal(mindmapDirectionFromKey('ArrowUp'), 'up')
  assert.equal(mindmapDirectionFromKey('ArrowDown'), 'down')
  assert.equal(mindmapDirectionFromKey('ArrowLeft'), 'left')
  assert.equal(mindmapDirectionFromKey('ArrowRight'), 'right')
  assert.equal(mindmapDirectionFromKey('Enter'), undefined)
})

test('mindmap navigation hops to the nearest visible node in the requested direction', () => {
  const nodes = [node('root', 0), node('left', 1), node('current', 2), node('right-near', 3), node('right-far', 4), node('down', 5), node('up', 6)]
  const positions = new Map([
    ['root', { x: 0, y: 100 }],
    ['left', { x: 120, y: 100 }],
    ['current', { x: 260, y: 100 }],
    ['right-near', { x: 420, y: 110 }],
    ['right-far', { x: 420, y: 260 }],
    ['down', { x: 260, y: 210 }],
    ['up', { x: 260, y: 20 }],
  ])

  assert.equal(navigateMindmapNode(nodes, positions, 'current', 'left'), 'left')
  assert.equal(navigateMindmapNode(nodes, positions, 'current', 'right'), 'right-near')
  assert.equal(navigateMindmapNode(nodes, positions, 'current', 'down'), 'down')
  assert.equal(navigateMindmapNode(nodes, positions, 'current', 'up'), 'up')
})

test('mindmap navigation does not steal arrows from terminal or form controls', () => {
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'TEXTAREA' }), true)
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'INPUT' }), true)
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'TEXTAREA', closest: () => ({}) }), true)
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'DIV', closest: (selector) => selector.includes('.terminal') ? ({}) : null }), true)
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'BUTTON', closest: (selector) => selector.includes('.map-node') ? ({}) : null }), false)
  assert.equal(blocksMindmapKeyboardNavigation({ tagName: 'BUTTON', closest: () => null }), true)
})
