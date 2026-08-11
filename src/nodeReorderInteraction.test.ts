import assert from 'node:assert/strict'
import test from 'node:test'
import { dragIntent, dropPositionAt, pointerReleaseIntent } from './nodeReorderInteraction.ts'

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
