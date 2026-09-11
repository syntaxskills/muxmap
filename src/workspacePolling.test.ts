import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkspacePayloadIfChanged, withAttachedSession } from './workspacePolling.ts'
import { demoWorkspaceGraph } from './demoGraph.ts'
import type { TerminalSession } from './model.ts'

test('attached sessions replace stale runtime state immediately and include newly adopted nodes', () => {
  const previous = demoWorkspaceGraph.sessions[0]
  const attached: TerminalSession = { ...previous, status: 'running', runtimeName: 'new-terminal', runtimeExists: undefined }
  const graph = {
    ...demoWorkspaceGraph,
    sessions: demoWorkspaceGraph.sessions.map((session) => session.id === previous.id ? { ...session, runtimeExists: false } : session),
    orphans: [{ backend: attached.backend, runtimeName: attached.runtimeName }, { backend: attached.backend, runtimeName: 'keep-orphan' }],
  }
  const updated = withAttachedSession(graph, attached)
  assert.equal(updated.sessions.length, graph.sessions.length)
  assert.deepEqual(updated.sessions.find((session) => session.id === attached.id), attached)
  assert.equal(updated.nodes, graph.nodes)
  assert.deepEqual(updated.orphans?.map((orphan) => orphan.runtimeName), ['keep-orphan'])
  assert.equal(graph.sessions[0].runtimeExists, false)

  const node = { ...graph.nodes[1], id: 'adopted-node' }
  const adopted = { ...attached, id: 'adopted-session', nodeId: node.id }
  const added = withAttachedSession(updated, adopted, node)
  assert.equal(added.nodes.at(-1), node)
  assert.equal(added.sessions.at(-1), adopted)
  assert.equal(withAttachedSession(added, adopted, node).nodes.length, added.nodes.length)
})

test('workspace poll skips JSON parsing when the raw payload is unchanged', () => {
  const payload = '{"workspace":{"id":"default"},"nodes":[],"sessions":[]}'
  assert.deepEqual(parseWorkspacePayloadIfChanged(payload, payload), { changed: false })
  assert.deepEqual(parseWorkspacePayloadIfChanged(null, payload), {
    changed: true,
    graph: { workspace: { id: 'default' }, nodes: [], sessions: [] },
  })
})
