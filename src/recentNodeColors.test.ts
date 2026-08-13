import assert from 'node:assert/strict'
import test from 'node:test'
import { forgetRecentNodeColor, maxRecentNodeColors, normalizeHexColor, recentNodeColorsFromJson, rememberRecentNodeColor } from './recentNodeColors.ts'

test('recent custom node colors normalize, dedupe, and cap at five', () => {
  let colors: string[] = []
  for (const color of ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666']) {
    colors = rememberRecentNodeColor(colors, color)
  }

  assert.equal(maxRecentNodeColors, 5)
  assert.deepEqual(colors, ['#666666', '#555555', '#444444', '#333333', '#222222'])
  assert.deepEqual(rememberRecentNodeColor(colors, '#444444'), ['#444444', '#666666', '#555555', '#333333', '#222222'])
})

test('recent custom node colors reject invalid values and survive malformed storage', () => {
  assert.equal(normalizeHexColor('#ABCDEF'), '#abcdef')
  assert.equal(normalizeHexColor('abcdef'), null)
  assert.equal(normalizeHexColor('#abcdex'), null)
  assert.deepEqual(recentNodeColorsFromJson('not json'), [])
  assert.deepEqual(recentNodeColorsFromJson(JSON.stringify(['#123456', '#123456', 'bad', '#abcdef'])), ['#123456', '#abcdef'])
})

test('recent custom node colors can be managed by removing one color', () => {
  const colors = ['#111111', '#222222', '#333333']
  assert.deepEqual(forgetRecentNodeColor(colors, '#222222'), ['#111111', '#333333'])
  assert.deepEqual(forgetRecentNodeColor(colors, 'bad'), colors)
})
