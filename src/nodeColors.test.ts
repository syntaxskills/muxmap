import assert from 'node:assert/strict'
import test from 'node:test'
import { nodeColorFamilies } from './nodeColors.ts'

test('node color presets provide three distinct shades for each expected family', () => {
  assert.deepEqual(nodeColorFamilies.map((family) => family.name), ['Blue', 'Green', 'Red', 'Pink', 'Brown'])
  assert.equal(nodeColorFamilies.every((family) => family.colors.length === 3), true)
  assert.equal(new Set(nodeColorFamilies.flatMap((family) => family.colors)).size, 15)
})
