import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkspacePayloadIfChanged } from './workspacePolling.ts'

test('workspace poll skips JSON parsing when the raw payload is unchanged', () => {
  const payload = '{"workspace":{"id":"default"},"nodes":[],"sessions":[]}'
  assert.deepEqual(parseWorkspacePayloadIfChanged(payload, payload), { changed: false })
  assert.deepEqual(parseWorkspacePayloadIfChanged(null, payload), {
    changed: true,
    graph: { workspace: { id: 'default' }, nodes: [], sessions: [] },
  })
})
