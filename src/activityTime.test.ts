import assert from 'node:assert/strict'
import test from 'node:test'
import { formatActivityAge } from './activityTime.ts'

const now = Date.parse('2026-08-11T12:00:00.000Z')
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString()

test('last activity uses compact minute, hour, and day units', () => {
  assert.equal(formatActivityAge(ago(20_000), now), 'NOW')
  assert.equal(formatActivityAge(ago(60_000), now), '1M')
  assert.equal(formatActivityAge(ago(55 * 60_000 + 59_000), now), '55M')
  assert.equal(formatActivityAge(ago(2 * 60 * 60_000), now), '2H')
  assert.equal(formatActivityAge(ago(36 * 60 * 60_000), now), '36H')
  assert.equal(formatActivityAge(ago(48 * 60 * 60_000), now), '2d')
  assert.equal(formatActivityAge(ago(10 * 24 * 60 * 60_000), now), '10d')
})

test('missing or invalid activity has no badge and future timestamps are current', () => {
  assert.equal(formatActivityAge(undefined, now), '')
  assert.equal(formatActivityAge('invalid', now), '')
  assert.equal(formatActivityAge(new Date(now + 60_000).toISOString(), now), 'NOW')
})
