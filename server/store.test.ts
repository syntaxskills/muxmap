import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createStore } from './store.ts'

test('workspace graph persists in SQLite across process restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-store-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    const initial = first.getWorkspace('default')
    assert.equal(initial.workspace.rootNodeId, 'workspace')
    assert.ok(initial.nodes.length >= 1)

    const created = first.createNode('default', {
      parentId: 'workspace',
      title: 'Persistent child',
      type: 'note',
      note: 'Saved in SQLite',
    })
    first.close()

    const second = createStore(database)
    assert.equal(second.getNode(created.id)?.title, 'Persistent child')
    assert.equal(second.getWorkspace('default').nodes.some((node) => node.id === created.id), true)
    second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('legacy idle agent records migrate to read instead of alerting again', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-agent-migration-'))
  const database = join(directory, 'muxmap.db')

  try {
    const first = createStore(database)
    first.upsertAgentActivity('muxmap-old', { kind: 'codex', state: 'completed', since: '2026-08-07T10:00:00.000Z' })
    first.close()
    const legacy = new DatabaseSync(database)
    legacy.exec("UPDATE agent_activity SET state = 'idle'")
    legacy.close()

    const migrated = createStore(database)
    assert.equal(migrated.getAgentActivity('muxmap-old')?.state, 'read')
    migrated.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('node creation validates hierarchy and input', () => {
  const store = createStore(':memory:')
  assert.throws(() => store.createNode('default', {
    parentId: 'missing',
    title: 'No parent',
    type: 'note',
  }), /parent/i)
  assert.throws(() => store.createNode('default', {
    parentId: 'workspace',
    title: '  ',
    type: 'note',
  }), /title/i)
  store.close()
})

test('node title, type, and metadata can be edited without changing its hierarchy', () => {
  const store = createStore(':memory:')
  const node = store.createNode('default', {
    parentId: 'workspace',
    title: 'New node',
    type: 'note',
  })

  const updated = store.updateNode(node.id, {
    title: 'Release checklist',
    type: 'todo',
    project: 'Platform',
    note: 'Run before deploy',
  })

  assert.equal(updated.title, 'Release checklist')
  assert.equal(updated.type, 'todo')
  assert.equal(updated.project, 'Platform')
  assert.equal(updated.note, 'Run before deploy')
  assert.equal(updated.parentId, 'workspace')
  assert.throws(() => store.updateNode(node.id, { title: '   ' }), /title/i)
  store.close()
})

test('children inherit node color and can override it independently', () => {
  const store = createStore(':memory:')
  const parent = store.createNode('default', { parentId: 'workspace', title: 'Parent', type: 'note', color: '#123456' })
  const child = store.createNode('default', { parentId: parent.id, title: 'Child', type: 'note' })
  assert.equal(child.color, '#123456')
  assert.equal(store.updateNode(child.id, { color: '#abcdef' }).color, '#abcdef')
  assert.equal(store.getNode(parent.id)?.color, '#123456')
  store.close()
})

test('sibling order can change without changing hierarchy', () => {
  const store = createStore(':memory:')
  const group = store.createNode('default', { parentId: 'workspace', title: 'Group', type: 'note' })
  const first = store.createNode('default', { parentId: group.id, title: 'First', type: 'note' })
  const second = store.createNode('default', { parentId: group.id, title: 'Second', type: 'note' })
  const third = store.createNode('default', { parentId: group.id, title: 'Third', type: 'note' })
  const nested = store.createNode('default', { parentId: first.id, title: 'Nested', type: 'note' })

  assert.deepEqual(store.reorderNode(third.id, second.id, 'before').map((node) => node.id), [first.id, third.id, second.id])
  assert.equal(store.getNode(third.id)?.parentId, group.id)
  assert.throws(() => store.reorderNode(nested.id, second.id, 'before'), /siblings/i)
  store.close()
})

test('deleting a node removes its branch records but never the workspace root', () => {
  const store = createStore(':memory:')
  const parent = store.createNode('default', { parentId: 'workspace', title: 'Branch', type: 'note' })
  const child = store.createNode('default', { parentId: parent.id, title: 'Leaf', type: 'note' })
  assert.deepEqual(store.deleteNode(parent.id).sort(), [child.id, parent.id].sort())
  assert.equal(store.getNode(parent.id), undefined)
  assert.equal(store.getNode(child.id), undefined)
  assert.throws(() => store.deleteNode('workspace'), /root/i)
  store.close()
})
