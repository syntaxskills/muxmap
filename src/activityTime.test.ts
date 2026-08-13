import assert from 'node:assert/strict'
import test from 'node:test'
import { activityStaleness, formatActivityAge } from './activityTime.ts'

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

test('activity staleness only dims the oldest half after at least 36 inactive hours', () => {
  const timestamps = [
    ago(2 * 60 * 60_000),
    ago(20 * 60 * 60_000),
    ago(36 * 60 * 60_000),
    ago(72 * 60 * 60_000),
  ]
  assert.deepEqual(
    timestamps.map((timestamp) => activityStaleness(timestamp, timestamps, now)),
    ['fresh', 'fresh', 'aging', 'stale'],
  )
})

test('activity staleness ignores missing, invalid, and future timestamps', () => {
  const timestamps = [ago(72 * 60 * 60_000), ago(2 * 60 * 60_000)]
  assert.equal(activityStaleness(undefined, timestamps, now), 'fresh')
  assert.equal(activityStaleness('invalid', timestamps, now), 'fresh')
  assert.equal(activityStaleness(new Date(now + 60_000).toISOString(), timestamps, now), 'fresh')
})

test('activity staleness never dims everything after a quiet weekend', () => {
  const timestamps = [
    ago(50 * 60 * 60_000),
    ago(55 * 60 * 60_000),
    ago(60 * 60 * 60_000),
    ago(65 * 60 * 60_000),
  ]
  assert.deepEqual(
    timestamps.map((timestamp) => activityStaleness(timestamp, timestamps, now)),
    ['fresh', 'fresh', 'aging', 'stale'],
  )
})

test('activity staleness threshold and oldest cohort are configurable', () => {
  const timestamps = [
    ago(10 * 60 * 60_000),
    ago(18 * 60 * 60_000),
    ago(42 * 60 * 60_000),
    ago(72 * 60 * 60_000),
  ]

  assert.equal(activityStaleness(timestamps[2], timestamps, now), 'aging')
  assert.equal(activityStaleness(timestamps[2], timestamps, now, { inactiveAfterHours: 48 }), 'fresh')
  assert.equal(activityStaleness(timestamps[2], timestamps, now, { inactiveAfterHours: 12, oldestPercent: 25 }), 'fresh')
  assert.equal(activityStaleness(timestamps[3], timestamps, now, { inactiveAfterHours: 12, oldestPercent: 25 }), 'stale')
  assert.equal(activityStaleness(timestamps[3], timestamps, now, { enabled: false }), 'fresh')
})
