import assert from 'node:assert/strict'
import test from 'node:test'
import { dragIntent, dropPositionAt } from './nodeReorderInteraction.ts'

test('node pointer gestures distinguish clicks from vertical reorder drags', () => {
  assert.equal(dragIntent({ x: 20, y: 20 }, { x: 23, y: 24 }), false)
  assert.equal(dragIntent({ x: 20, y: 20 }, { x: 20, y: 27 }), true)
  assert.equal(dropPositionAt(109, { top: 100, height: 42 }), 'before')
  assert.equal(dropPositionAt(133, { top: 100, height: 42 }), 'after')
})
