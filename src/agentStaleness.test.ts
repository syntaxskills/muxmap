import assert from 'node:assert/strict'
import test from 'node:test'
import { STALE_BACKGROUND_MS, canAcknowledgeAgentOnOpen, isStaleBackgroundAgent } from './agentStaleness.ts'

const now = Date.parse('2026-08-07T12:00:00.000Z')

test('stale background threshold is shared by display and acknowledge behavior', () => {
  assert.equal(STALE_BACKGROUND_MS, 2 * 60 * 60 * 1000)
  assert.equal(isStaleBackgroundAgent({ state: 'delegated', since: '2026-08-07T09:00:00.000Z' }, now), true)
  assert.equal(isStaleBackgroundAgent({ state: 'delegated', since: '2026-08-07T11:00:00.000Z' }, now), false)
  assert.equal(isStaleBackgroundAgent({ state: 'standby', since: '2026-08-07T09:00:00.000Z' }, now), true)
  assert.equal(isStaleBackgroundAgent({ state: 'working', since: '2026-08-07T09:00:00.000Z' }, now), false)
})

test('opening a terminal can acknowledge completed, standby, and stale delegated only', () => {
  assert.equal(canAcknowledgeAgentOnOpen({ state: 'completed' }, now), true)
  assert.equal(canAcknowledgeAgentOnOpen({ state: 'standby', since: '2026-08-07T11:59:00.000Z' }, now), true)
  assert.equal(canAcknowledgeAgentOnOpen({ state: 'delegated', since: '2026-08-07T09:00:00.000Z' }, now), true)
  assert.equal(canAcknowledgeAgentOnOpen({ state: 'delegated', since: '2026-08-07T11:00:00.000Z' }, now), false)
  assert.equal(canAcknowledgeAgentOnOpen({ state: 'working', since: '2026-08-07T09:00:00.000Z' }, now), false)
  assert.equal(canAcknowledgeAgentOnOpen({ state: 'needs_input', since: '2026-08-07T09:00:00.000Z' }, now), false)
})
