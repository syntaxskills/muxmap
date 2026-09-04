import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createMuxMapServer } from './app.ts'
import { handleMcpMessage } from './mcp-adapter.ts'
import type { TmuxAdapter } from './sessions.ts'
import type { AgentChannel, TerminalSession } from '../src/model.ts'

function fakeTmux(): TmuxAdapter {
  const live = new Set<string>()
  return {
    exists: (name) => live.has(name),
    list: () => [...live],
    create(name) {
      live.add(name)
    },
    stop(name) {
      live.delete(name)
    },
  }
}

function basic(token: string) {
  return `Basic ${Buffer.from(`muxmap:${token}`).toString('base64')}`
}

function textPayload(response: unknown) {
  const rpc = response as { result: { content: Array<{ text: string }>; isError?: boolean } }
  assert.equal(rpc.result.isError, false)
  return JSON.parse(rpc.result.content[0]!.text) as Record<string, unknown>
}

test('MCP adapter exposes MuxMap channel tools over JSON-RPC', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-mcp-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'mcp-token',
    requireBasicAuth: true,
    tmux: fakeTmux(),
    ptyFactory: () => ({
      onData() {},
      onExit() {},
      write() {},
      scroll() {},
      resize() {},
      kill() {},
    }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`, { headers: { authorization: basic('mcp-token') } })
    assert.equal(auth.status, 200)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { authorization: basic('mcp-token'), cookie, origin: base, 'content-type': 'application/json' }
    const createNode = async (title: string) => {
      const response = await fetch(`${base}/api/workspaces/default/nodes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ parentId: 'workspace', title, type: 'terminal', repoPath: root }),
      })
      assert.equal(response.status, 201)
      return response.json() as Promise<{ id: string }>
    }
    const first = await createNode('Claude implementation')
    const second = await createNode('Codex review')
    const firstSession = await fetch(`${base}/api/nodes/${first.id}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: TerminalSession }
    assert.equal(firstSession.session.status, 'running')
    await fetch(`${base}/api/nodes/${second.id}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    })
    const channelResponse = await fetch(`${base}/api/workspaces/default/agent-channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceNodeId: first.id, targetNodeId: second.id }),
    })
    assert.equal(channelResponse.status, 201)
    const { channel } = await channelResponse.json() as { channel: AgentChannel }
    const env = { MUXMAP_URL: base, MUXMAP_TOKEN: 'mcp-token', MUXMAP_NODE_ID: first.id }

    const initialize = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } }, { env })
    assert.deepEqual((initialize as { result: { capabilities: unknown } }).result.capabilities, { tools: {} })
    const toolList = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { env })
    assert.deepEqual((toolList as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name), [
      'muxmap_list_channels',
      'muxmap_read_channel',
      'muxmap_send_channel_message',
      'muxmap_channel_usage',
      'muxmap_add_node_note',
      'muxmap_get_node_notes',
      'muxmap_update_node_step',
      'muxmap_get_node_steps',
      'muxmap_get_node_step_definitions',
    ])
    const updateStepTool = ((toolList as { result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }> } }).result.tools).find((tool) => tool.name === 'muxmap_update_node_step')
    assert.deepEqual(updateStepTool?.inputSchema.properties.stepKey.enum, ['initialized', 'ticket_created', 'in_progress', 'mr_raised', 'finalized'])

    const listed = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'muxmap_list_channels', arguments: {} },
    }, { env }))
    assert.deepEqual((listed.channels as AgentChannel[]).map((item) => item.id), [channel.id])

    const posted = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'muxmap_send_channel_message',
        arguments: { channelId: channel.mcpUri, body: 'Please review the failing unit test.', tokenCount: 9 },
      },
    }, { env }))
    assert.equal(((posted.message as Record<string, unknown>).authorNodeId), first.id)
    assert.equal(((posted.usage as Record<string, unknown>).tokenCount), 9)

    const read = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'muxmap_read_channel', arguments: { channelId: channel.id } },
    }, { env }))
    assert.deepEqual((read.messages as Array<{ body: string }>).map((message) => message.body), ['Please review the failing unit test.'])

    const usage = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'muxmap_channel_usage', arguments: { channelId: channel.id } },
    }, { env }))
    assert.equal((usage.usage as Record<string, unknown>).messageCount, 1)

    const updatedSteps = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'muxmap_update_node_step',
        arguments: { stepKey: 'mr_raised', ref: '!13595', url: 'https://gitlab.example/group/repo/-/merge_requests/13595' },
      },
    }, { env }))
    const mrStep = (updatedSteps.steps as Array<Record<string, unknown>>).find((step) => step.key === 'mr_raised')
    assert.equal(mrStep?.status, 'done')
    assert.equal(mrStep?.ref, '!13595')
    assert.equal(mrStep?.updatedBy, firstSession.session.id)

    const readSteps = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'muxmap_get_node_steps', arguments: {} },
    }, { env }))
    assert.equal((readSteps.steps as Array<Record<string, unknown>>).find((step) => step.key === 'mr_raised')?.url, 'https://gitlab.example/group/repo/-/merge_requests/13595')

    const definitions = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'muxmap_get_node_step_definitions', arguments: {} },
    }, { env }))
    assert.deepEqual((definitions.steps as Array<Record<string, unknown>>).map((step) => step.key), ['initialized', 'ticket_created', 'in_progress', 'mr_raised', 'finalized'])

    const addedNote = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'muxmap_add_node_note', arguments: { label: 'PR #42', url: 'https://github.com/example/muxmap/pull/42', body: 'Ready for review.' } },
    }, { env }))
    assert.equal((addedNote.note as Record<string, unknown>).provider, 'github')
    assert.equal((addedNote.note as Record<string, unknown>).createdBy, firstSession.session.id)

    const notes = textPayload(await handleMcpMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'muxmap_get_node_notes', arguments: {} },
    }, { env }))
    assert.equal((notes.notes as Array<Record<string, unknown>>)[0]?.label, 'PR #42')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('MCP adapter returns tool errors as MCP tool results instead of crashing the server', async () => {
  const response = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 'bad-call',
    method: 'tools/call',
    params: { name: 'muxmap_send_channel_message', arguments: { channelId: 'missing', body: 'hello' } },
  }, { env: {} })
  const result = (response as { result: { isError: boolean; content: Array<{ text: string }> } }).result
  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /authorNodeId is required/)

  const missingNodeResponse = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 'missing-node',
    method: 'tools/call',
    params: { name: 'muxmap_update_node_step', arguments: { stepKey: 'ticket_created' } },
  }, { env: {} })
  const missingNodeResult = (missingNodeResponse as { result: { isError: boolean; content: Array<{ text: string }> } }).result
  assert.equal(missingNodeResult.isError, true)
  assert.match(missingNodeResult.content[0]!.text, /nodeId is required/)

  const missingNoteNode = await handleMcpMessage({
    jsonrpc: '2.0', id: 'missing-note-node', method: 'tools/call',
    params: { name: 'muxmap_add_node_note', arguments: { body: 'No target' } },
  }, { env: {} })
  assert.match((missingNoteNode as { result: { content: Array<{ text: string }> } }).result.content[0]!.text, /nodeId is required/)
})

test('MCP tools/list reflects configured lifecycle step keys from MuxMap', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-mcp-custom-steps-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'mcp-token',
    requireBasicAuth: true,
    nodeStepDefinitions: [
      { key: 'briefed', label: 'Briefed' },
      { key: 'patched', label: 'Patched' },
      { key: 'verified', label: 'Verified' },
    ],
    tmux: fakeTmux(),
    ptyFactory: () => ({
      onData() {},
      onExit() {},
      write() {},
      scroll() {},
      resize() {},
      kill() {},
    }),
  })

  try {
    const address = await server.listen(0)
    const env = { MUXMAP_URL: `http://127.0.0.1:${address.port}`, MUXMAP_TOKEN: 'mcp-token' }
    const toolList = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { env })
    const updateStepTool = ((toolList as { result: { tools: Array<{ name: string; description: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }> } }).result.tools).find((tool) => tool.name === 'muxmap_update_node_step')
    assert.deepEqual(updateStepTool?.inputSchema.properties.stepKey.enum, ['briefed', 'patched', 'verified'])
    assert.match(updateStepTool?.description ?? '', /briefed \(Briefed\).*patched \(Patched\).*verified \(Verified\)/)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
