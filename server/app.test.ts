import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import xterm from '@xterm/xterm'
import WebSocket from 'ws'
import { createMuxMapServer, defaultPtyFactory, tmuxPtyFallbackCommand, type PtyFactory, type PtyHandle } from './app.ts'
import { realTmux, realZellij, zellijConfigPath, zellijExecutable, type TmuxAdapter } from './sessions.ts'
import type { TerminalSession } from '../src/model.ts'

const { Terminal } = xterm

function fakeTmux(options: { currentWorkingDirectories?: Record<string, string> } = {}): TmuxAdapter & { stopped: string[]; live: Set<string>; createCommands: Array<string[] | undefined> } {
  const live = new Set<string>()
  return {
    live,
    stopped: [],
    createCommands: [],
    exists: (name) => live.has(name),
    list: () => [...live],
    create(name, _cwd, command) {
      this.createCommands.push(command)
      live.add(name)
    },
    stop(name) {
      this.stopped.push(name)
      live.delete(name)
    },
    currentWorkingDirectory(name) {
      return options.currentWorkingDirectories?.[name]
    },
  }
}

function fakePtyFactory(record: { writes: string[]; resizes: number[][]; kills: number[]; starts?: number[][]; scrolls?: number[]; emitData?: (data: string) => void; autoReady?: boolean }): PtyFactory {
  return (_session, size) => {
    if (size) record.starts?.push([size.cols, size.rows])
    const dataListeners: Array<(data: string) => void> = []
    const handle: PtyHandle = {
      onData(listener) {
        dataListeners.push(listener)
        record.emitData = listener
        if (record.autoReady !== false) listener('ready')
      },
      onExit() {},
      write: (data) => { record.writes.push(data) },
      scroll: (lines) => { record.scrolls?.push(lines) },
      resize: (cols, rows) => { record.resizes.push([cols, rows]) },
      kill: () => { record.kills.push(1) },
    }
    return handle
  }
}

async function eventually(predicate: () => boolean, timeout = 2000) {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(predicate(), true)
}

test('secured workspace and node APIs return persisted graph data', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-api-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const unauthenticated = await fetch(`${base}/api/workspaces/default`)
    assert.equal(unauthenticated.status, 401)

    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)

    const forbidden = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Blocked', type: 'note' }),
    })
    assert.equal(forbidden.status, 403)

    const created = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'API child', type: 'note' }),
    })
    assert.equal(created.status, 201)
    const createdNode = await created.json() as { id: string; steps?: Array<{ key: string; status: string }> }
    assert.equal(createdNode.steps?.find((step) => step.key === 'initialized')?.status, 'done')

    const initialSteps = await fetch(`${base}/api/nodes/${createdNode.id}/steps`, { headers: { cookie } })
    assert.equal(initialSteps.status, 200)
    assert.equal(((await initialSteps.json()) as { steps: Array<{ key: string; status: string }> }).steps.find((step) => step.key === 'initialized')?.status, 'done')

    const updatedStep = await fetch(`${base}/api/nodes/${createdNode.id}/steps/ticket_created`, {
      method: 'PUT',
      headers: { cookie, origin: base, 'content-type': 'application/json', 'x-muxmap-updated-by': 'api-test' },
      body: JSON.stringify({ status: 'done', ref: 'DEV-2830', url: 'https://jira.example/browse/DEV-2830' }),
    })
    assert.equal(updatedStep.status, 200)
    const updatedStepPayload = await updatedStep.json() as { steps: Array<{ key: string; status: string; ref?: string; url?: string; updatedBy?: string }> }
    assert.equal(updatedStepPayload.steps.find((step) => step.key === 'ticket_created')?.ref, 'DEV-2830')
    assert.equal(updatedStepPayload.steps.find((step) => step.key === 'ticket_created')?.updatedBy, 'api-test')

    const invalidStep = await fetch(`${base}/api/nodes/${createdNode.id}/steps/not_a_step`, {
      method: 'PUT',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    assert.equal(invalidStep.status, 400)

    const invalidUrl = await fetch(`${base}/api/nodes/${createdNode.id}/steps/ticket_created`, {
      method: 'PUT',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', url: 'ftp://example.test/ticket' }),
    })
    assert.equal(invalidUrl.status, 400)
    const unchanged = await fetch(`${base}/api/nodes/${createdNode.id}/steps`, { headers: { cookie } }).then((response) => response.json()) as { steps: Array<{ key: string; ref?: string }> }
    assert.equal(unchanged.steps.find((step) => step.key === 'ticket_created')?.ref, 'DEV-2830')

    const missingNodeSteps = await fetch(`${base}/api/nodes/missing-node/steps`, { headers: { cookie } })
    assert.equal(missingNodeSteps.status, 404)

    const renamed = await fetch(`${base}/api/nodes/${createdNode.id}`, {
      method: 'PATCH',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed in place', type: 'todo', doneAt: '2026-08-19T12:00:00.000Z' }),
    })
    assert.equal(renamed.status, 200)
    const renamedNode = await renamed.json() as { title: string; type: string; doneAt?: string }
    assert.equal(renamedNode.title, 'Renamed in place')
    assert.equal(renamedNode.type, 'todo')
    assert.equal(renamedNode.doneAt, '2026-08-19T12:00:00.000Z')

    const undone = await fetch(`${base}/api/nodes/${createdNode.id}`, {
      method: 'PATCH',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ doneAt: null }),
    })
    assert.equal(undone.status, 200)
    assert.equal(((await undone.json()) as { doneAt?: string }).doneAt, undefined)

    const second = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Second child', type: 'note' }),
    })
    const secondNode = await second.json() as { id: string }
    const reordered = await fetch(`${base}/api/nodes/${secondNode.id}/reorder`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ targetId: createdNode.id, position: 'before' }),
    })
    assert.equal(reordered.status, 200)
    const reorderedNodes = await reordered.json() as { nodes: Array<{ id: string }> }
    assert.deepEqual(reorderedNodes.nodes.filter((node) => node.id === createdNode.id || node.id === secondNode.id).map((node) => node.id), [secondNode.id, createdNode.id])

    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })
    const graph = await workspace.json() as { nodes: Array<{ id: string; title: string; type: string; doneAt?: string; steps?: Array<{ key: string; ref?: string }> }>; runtime: { platform: string; terminalBackends: string[] } }
    assert.equal(graph.nodes.some((node) => node.id === createdNode.id), true)
    assert.equal(graph.nodes.find((node) => node.id === createdNode.id)?.title, 'Renamed in place')
    assert.equal(graph.nodes.find((node) => node.id === createdNode.id)?.type, 'todo')
    assert.equal(graph.nodes.find((node) => node.id === createdNode.id)?.doneAt, undefined)
    assert.equal(graph.nodes.find((node) => node.id === createdNode.id)?.steps?.find((step) => step.key === 'ticket_created')?.ref, 'DEV-2830')
    assert.equal(graph.runtime.platform, 'linux')
    assert.equal(graph.runtime.terminalBackends.includes('tmux'), true)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('LAN mode requires persistent basic auth before issuing its session cookie', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-lan-auth-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'persistent-token',
    requireBasicAuth: true,
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const denied = await fetch(`${base}/api/auth`)
    assert.equal(denied.status, 401)
    assert.match(denied.headers.get('www-authenticate') ?? '', /^Basic /)

    const auth = await fetch(`${base}/api/auth`, {
      headers: { authorization: `Basic ${Buffer.from('muxmap:persistent-token').toString('base64')}` },
    })
    assert.equal(auth.status, 200)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    assert.equal((await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })).status, 200)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace API exposes configured node lifecycle steps and validates custom keys', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-api-custom-steps-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    nodeStepDefinitions: [
      { key: 'briefed', label: 'Briefed' },
      { key: 'implemented', label: 'Implemented' },
      { key: 'verified', label: 'Verified' },
    ],
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const created = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title: 'Configured flow', type: 'ticket' }),
    }).then((response) => response.json()) as { id: string; steps: Array<{ key: string; status: string }> }
    assert.equal(created.steps[0]?.key, 'briefed')
    assert.equal(created.steps[0]?.status, 'done')

    const stepDefinitions = await fetch(`${base}/api/node-step-definitions`, { headers: { cookie } }).then((response) => response.json()) as { steps: Array<{ key: string; label: string }> }
    assert.deepEqual(stepDefinitions.steps.map((step) => step.key), ['briefed', 'implemented', 'verified'])

    const editedDefinitions = await fetch(`${base}/api/node-step-definitions`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ steps: [{ key: 'planned', label: 'Planned' }, { key: 'shipped', label: 'Shipped' }] }),
    })
    assert.equal(editedDefinitions.status, 200)
    assert.deepEqual(((await editedDefinitions.json()) as { steps: Array<{ key: string }> }).steps.map((step) => step.key), ['planned', 'shipped'])

    const invalidDefinitions = await fetch(`${base}/api/node-step-definitions`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ steps: [{ key: 'bad key', label: 'Bad' }] }),
    })
    assert.equal(invalidDefinitions.status, 400)

    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { nodeStepDefinitions: Array<{ key: string }>; nodes: Array<{ id: string; steps?: Array<{ key: string }> }> }
    assert.deepEqual(workspace.nodeStepDefinitions.map((step) => step.key), ['planned', 'shipped'])
    assert.equal(workspace.nodes.find((node) => node.id === created.id)?.steps?.[0]?.key, 'planned')

    const invalidLegacyKey = await fetch(`${base}/api/nodes/${created.id}/steps/ticket_created`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'done' }),
    })
    assert.equal(invalidLegacyKey.status, 400)
    const validCustomKey = await fetch(`${base}/api/nodes/${created.id}/steps/shipped`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'done', ref: 'MR-1', url: 'https://gitlab.example/mr/1' }),
    })
    assert.equal(validCustomKey.status, 200)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('agent channel and terminal input history APIs persist collaboration state', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-channel-api-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const createNode = async (title: string) => (await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title, type: 'terminal', repoPath: root }),
    })).json() as Promise<{ id: string }>
    const first = await createNode('Claude implementation agent')
    const second = await createNode('Codex review agent')
    const firstSession = await fetch(`${base}/api/nodes/${first.id}/session`, { method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }) }).then((response) => response.json()) as { session: TerminalSession }
    await fetch(`${base}/api/nodes/${second.id}/session`, { method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }) })

    const channelResponse = await fetch(`${base}/api/workspaces/default/agent-channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sourceNodeId: first.id, targetNodeId: second.id }),
    })
    assert.equal(channelResponse.status, 201)
    const { channel } = await channelResponse.json() as { channel: { id: string; mcpUri: string; deliveryPolicy: string; tokenHardStopPerHour: number } }
    assert.match(channel.mcpUri, /^muxmap:\/\/agent-channels\//)
    assert.equal(channel.deliveryPolicy, 'human-gated')
    assert.equal(channel.tokenHardStopPerHour, 500000)

    const message = await fetch(`${base}/api/agent-channels/${channel.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ authorNodeId: first.id, body: 'Please compare the failing test output.', tokenCount: 12 }),
    })
    assert.equal(message.status, 201)
    const posted = await message.json() as { usage: { tokenCount: number; warning: boolean } }
    assert.equal(posted.usage.tokenCount, 12)
    assert.equal(posted.usage.warning, false)
    const messages = await fetch(`${base}/api/agent-channels/${channel.id}/messages`, { headers: { cookie } }).then((response) => response.json()) as { messages: Array<{ body: string }> }
    assert.deepEqual(messages.messages.map((item) => item.body), ['Please compare the failing test output.'])
    const usage = await fetch(`${base}/api/agent-channels/${channel.id}/usage`, { headers: { cookie } }).then((response) => response.json()) as { usage: { tokenCount: number } }
    assert.equal(usage.usage.tokenCount, 12)

    await fetch(`${base}/api/sessions/${firstSession.session.id}/input-history`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ value: 'bun run test' }),
    })
    const history = await fetch(`${base}/api/sessions/${firstSession.session.id}/input-history`, { headers: { cookie } }).then((response) => response.json()) as { history: Array<{ value: string }> }
    assert.deepEqual(history.history.map((item) => item.value), ['bun run test'])

    const graph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { channels: unknown[] }
    assert.equal(graph.channels.length, 1)
    const closeResponse = await fetch(`${base}/api/agent-channels/${channel.id}`, {
      method: 'DELETE',
      headers,
    })
    assert.equal(closeResponse.status, 200)
    const closed = await closeResponse.json() as { channel: { status: string; closedReason: string } }
    assert.equal(closed.channel.status, 'closed')
    assert.equal(closed.channel.closedReason, 'Closed by user')
    const graphAfterClose = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { channels: unknown[] }
    assert.equal(graphAfterClose.channels.length, 0)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('file preview API opens files inside allowed roots and rejects outside paths', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-files-')))
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-files-outside-')))
  mkdirSync(join(root, 'src'), { recursive: true })
  const file = join(root, 'src', 'App.tsx')
  writeFileSync(file, 'one\nconst value = 1\nthree\n')
  writeFileSync(join(outside, 'secret.ts'), 'secret\n')
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const cookie = (await fetch(`${base}/api/auth`)).headers.get('set-cookie')?.split(';')[0] ?? ''
    const preview = await fetch(`${base}/api/files/open?path=${encodeURIComponent('src/App.tsx')}&cwd=${encodeURIComponent(root)}&line=2&column=7`, { headers: { cookie } })
    assert.equal(preview.status, 200)
    assert.match(preview.headers.get('content-type') ?? '', /^text\/html/)
    const html = await preview.text()
    assert.match(html, /<tr id="L2" class="is-selected">/)
    assert.match(html, /const value = 1/)

    const denied = await fetch(`${base}/api/files/open?path=${encodeURIComponent(join(outside, 'secret.ts'))}`, { headers: { cookie } })
    assert.equal(denied.status, 400)
    assert.deepEqual(await denied.json(), { error: 'File path is outside allowed roots' })
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('file preview API resolves terminal relative links against the live tmux pane cwd', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-live-cwd-files-')))
  const initialCwd = join(root, 'initial')
  const liveCwd = join(root, 'live')
  mkdirSync(join(initialCwd, 'my_ignore'), { recursive: true })
  mkdirSync(join(liveCwd, 'my_ignore'), { recursive: true })
  writeFileSync(join(liveCwd, 'my_ignore', 'swimlane_apm_direct_requests.md'), '# opened from live cwd\n')
  const currentWorkingDirectories: Record<string, string> = {}
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux: fakeTmux({ currentWorkingDirectories }),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const cookie = (await fetch(`${base}/api/auth`)).headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const node = await (await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title: 'Live cwd links', type: 'terminal' }),
    })).json() as { id: string }
    const attached = await (await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: initialCwd }),
    })).json() as { session: TerminalSession }
    currentWorkingDirectories[attached.session.runtimeName] = liveCwd

    const preview = await fetch(`${base}/api/files/open?path=${encodeURIComponent('my_ignore/swimlane_apm_direct_requests.md')}&cwd=${encodeURIComponent(initialCwd)}&sessionId=${encodeURIComponent(attached.session.id)}`, { headers: { cookie } })
    assert.equal(preview.status, 200)
    const html = await preview.text()
    assert.match(html, /opened from live cwd/)
    assert.match(html, new RegExp(liveCwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('attachment API stores pasted images and rejects unsupported clipboard payloads', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-attachments-root-')))
  const attachments = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-attachments-store-')))
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    attachmentsDirectory: attachments,
    platform: 'linux',
    token: 'test-token',
    tmux: fakeTmux(),
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const cookie = (await fetch(`${base}/api/auth`)).headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const uploaded = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }),
    })
    assert.equal(uploaded.status, 201)
    const body = await uploaded.json() as { url: string; markdown: string }
    assert.match(body.url, /^\/api\/attachments\/[a-f0-9-]+\.png$/)
    assert.equal(body.markdown, `![pasted image](${body.url})`)

    const image = await fetch(`${base}${body.url}`, { headers: { cookie } })
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.equal(await image.text(), 'hello')

    const rejected = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'text/plain', dataUrl: 'data:text/plain;base64,aGVsbG8=' }),
    })
    assert.equal(rejected.status, 400)
    assert.deepEqual(await rejected.json(), { error: 'Unsupported image type' })
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(attachments, { recursive: true, force: true })
  }
})

test('archive stops branch terminal sessions while restore keeps them stopped', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-archive-api-')))
  const tmux = fakeTmux()
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const created = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Done', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const attached = await fetch(`${base}/api/nodes/${created.id}/session`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { id: string; runtimeName: string } }
    const child = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: created.id, title: 'Nested terminal', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const childAttached = await fetch(`${base}/api/nodes/${child.id}/session`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { id: string; runtimeName: string } }

    const archivedResponse = await fetch(`${base}/api/nodes/${created.id}/archive`, { method: 'POST', headers, body: '{}' })
    assert.equal(archivedResponse.status, 200)
    const archived = await archivedResponse.json() as { node: { archivedAt?: string }; stoppedSessionNames: string[] }
    assert.ok(archived.node.archivedAt)
    assert.deepEqual(archived.stoppedSessionNames.sort(), [attached.session.runtimeName, childAttached.session.runtimeName].sort())
    assert.equal(tmux.live.has(attached.session.runtimeName), false)
    assert.equal(tmux.live.has(childAttached.session.runtimeName), false)
    assert.equal(server.store.getSession(attached.session.id)?.status, 'stopped')
    assert.equal(server.store.getSession(childAttached.session.id)?.status, 'stopped')

    const restoredResponse = await fetch(`${base}/api/nodes/${created.id}/restore`, { method: 'POST', headers, body: '{}' })
    assert.equal(restoredResponse.status, 200)
    const restored = await restoredResponse.json() as { node: { archivedAt?: string } }
    assert.equal(restored.node.archivedAt, undefined)
    assert.equal(tmux.live.has(attached.session.runtimeName), false)
    assert.equal(tmux.live.has(childAttached.session.runtimeName), false)
    assert.equal(server.store.getSession(attached.session.id)?.status, 'stopped')
    assert.equal(server.store.getSession(childAttached.session.id)?.status, 'stopped')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('websocket detaches safely and workspace refresh surfaces a missing tmux session', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-ws-')))
  const tmux = fakeTmux()
  const ptyRecord = { writes: [] as string[], resizes: [] as number[][], kills: [] as number[], starts: [] as number[][], scrolls: [] as number[] }
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory(ptyRecord),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const nodeResponse = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Shell task', type: 'terminal', repoPath: root }),
    })
    const node = await nodeResponse.json() as { id: string }
    const sessionResponse = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    })
    const { session } = await sessionResponse.json() as { session: { id: string } }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach?cols=84&rows=27`, {
      headers: { cookie, origin: base },
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    ws.send(JSON.stringify({ type: 'input', data: 'pwd\r' }))
    ws.send(JSON.stringify({ type: 'scroll', lines: -4 }))
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 36 }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const connectedGraph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: Array<{ id: string; status: string }> }
    assert.equal(connectedGraph.sessions.find((item) => item.id === session.id)?.status, 'running')
    ws.close()
    await new Promise((resolve) => ws.once('close', resolve))
    await eventually(() => ptyRecord.kills.length === 1)

    assert.deepEqual(ptyRecord.writes, ['pwd\r'])
    assert.deepEqual(ptyRecord.scrolls, [-4])
    assert.deepEqual(ptyRecord.starts, [])
    assert.deepEqual(ptyRecord.resizes, [])
    assert.equal(ptyRecord.kills.length, 1)
    assert.equal(tmux.stopped.length, 0)
    assert.equal(server.store.getSession(session.id)?.status, 'detached')

    const reopened = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach`, {
      headers: { cookie, origin: base },
    })
    await new Promise<void>((resolve, reject) => {
      reopened.once('open', resolve)
      reopened.once('error', reject)
    })
    reopened.close()
    await new Promise((resolve) => reopened.once('close', resolve))
    await eventually(() => ptyRecord.kills.length === 2)
    assert.equal(ptyRecord.kills.length, 2)
    assert.equal(tmux.stopped.length, 0)

    tmux.live.clear()
    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })
    const graph = await workspace.json() as { sessions: Array<{ id: string; status: string }> }
    assert.equal(graph.sessions.find((item) => item.id === session.id)?.status, 'stopped')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('websocket attaches at the current pane size and resizes after first output', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-ws-resize-')))
  const tmux = fakeTmux()
  const ptyRecord = { writes: [] as string[], resizes: [] as number[][], kills: [] as number[], starts: [] as number[][], autoReady: false, emitData: undefined as ((data: string) => void) | undefined }
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory(ptyRecord),
    outputFlushIntervalMs: 1,
    initialResizeDelayMs: 5,
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title: 'Heavy Claude', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const { session } = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { id: string } }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach?cols=84&rows=27`, {
      headers: { cookie, origin: base },
    })
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })

    assert.deepEqual(ptyRecord.starts, [])
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 36 }))
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(ptyRecord.resizes, [])

    ptyRecord.emitData?.('buffered screen')
    await eventually(() => ptyRecord.resizes.length === 1)
    assert.deepEqual(ptyRecord.resizes, [[120, 36]])

    ws.close()
    await new Promise((resolve) => ws.once('close', resolve))
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('stopped node session API can start a new runtime instead of resuming the old one', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-api-start-new-')))
  const tmux = fakeTmux()
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title: 'Switch agent', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const attached = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: TerminalSession }
    await fetch(`${base}/api/sessions/${attached.session.id}/stop`, { method: 'POST', headers, body: '{}' })

    const fresh = await fetch(`${base}/api/nodes/${node.id}/session/new`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: TerminalSession }

    assert.equal(fresh.session.id, attached.session.id)
    assert.equal(fresh.session.status, 'running')
    assert.notEqual(fresh.session.runtimeName, attached.session.runtimeName)
    assert.equal(tmux.live.has(attached.session.runtimeName), false)
    assert.equal(tmux.live.has(fresh.session.runtimeName), true)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('session API can suspend runtimes and auto suspend oldest quiet sessions', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-api-suspend-')))
  const tmux = fakeTmux()
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const createNode = async (title: string) => fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title, type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as Promise<{ id: string }>
    const attach = async (nodeId: string) => fetch(`${base}/api/nodes/${nodeId}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as Promise<{ session: TerminalSession }>

    const firstNode = await createNode('Manual suspend')
    const first = await attach(firstNode.id)
    const suspended = await fetch(`${base}/api/sessions/${first.session.id}/suspend`, { method: 'POST', headers, body: '{}' }).then((response) => response.json()) as { session: TerminalSession }
    assert.equal(suspended.session.status, 'suspended')
    assert.equal(tmux.live.has(first.session.runtimeName), false)

    const resumed = await attach(firstNode.id)
    assert.equal(resumed.session.runtimeName, first.session.runtimeName)
    assert.equal(resumed.session.status, 'running')

    const secondNode = await createNode('Auto suspend oldest')
    const thirdNode = await createNode('Auto keep current')
    const second = await attach(secondNode.id)
    const third = await attach(thirdNode.id)
    server.store.updateSessionActivity(first.session.id, '2026-08-07T10:00:00.000Z')
    server.store.updateSessionActivity(second.session.id, '2026-08-07T10:01:00.000Z')
    server.store.updateSessionActivity(third.session.id, '2026-08-07T10:02:00.000Z')

    const auto = await fetch(`${base}/api/sessions/auto-suspend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ maxActive: 1, keepSessionId: third.session.id }),
    }).then((response) => response.json()) as { sessions: TerminalSession[] }
    assert.deepEqual(auto.sessions.map((session) => session.runtimeName), [first.session.runtimeName, second.session.runtimeName])
    const graph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    assert.equal(graph.sessions.find((session) => session.id === first.session.id)?.status, 'suspended')
    assert.equal(graph.sessions.find((session) => session.id === second.session.id)?.status, 'suspended')
    assert.equal(graph.sessions.find((session) => session.id === third.session.id)?.status, 'detached')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('terminal input and output both advance persisted last activity', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-terminal-activity-')))
  const tmux = fakeTmux()
  const ptyRecord = { writes: [] as string[], resizes: [] as number[][], kills: [] as number[], emitData: undefined as ((data: string) => void) | undefined }
  let serverClosed = false
  const server = createMuxMapServer({
    databasePath: ':memory:', allowedRoots: [root], platform: 'linux', token: 'test-token', tmux,
    ptyFactory: fakePtyFactory(ptyRecord), activityWriteIntervalMs: 0,
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const cookie = (await fetch(`${base}/api/auth`)).headers.get('set-cookie')?.split(';')[0] ?? ''
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Activity shell', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const session = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: TerminalSession }
    const initial = Date.parse(session.session.lastActivityAt ?? session.session.lastAttachedAt ?? session.session.createdAt)
    await new Promise((resolve) => setTimeout(resolve, 5))

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.session.id}/attach`, { headers: { cookie, origin: base } })
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    await eventually(() => Date.parse(server.store.getSession(session.session.id)?.lastActivityAt ?? '') > initial)
    const outputAt = Date.parse(server.store.getSession(session.session.id)?.lastActivityAt ?? '')

    await new Promise((resolve) => setTimeout(resolve, 5))
    ws.send(JSON.stringify({ type: 'input', data: 'echo hello\r' }))
    await eventually(() => Date.parse(server.store.getSession(session.session.id)?.lastActivityAt ?? '') > outputAt)
    ws.close()
    await new Promise((resolve) => ws.once('close', resolve))
    await server.close()
    serverClosed = true
    assert.doesNotThrow(() => ptyRecord.emitData?.('late terminal output'))
  } finally {
    if (!serverClosed) await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('websocket terminal output is batched before reaching the browser', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-output-batch-')))
  const tmux = fakeTmux()
  let emitData: ((data: string) => void) | undefined
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    outputFlushIntervalMs: 20,
    ptyFactory: () => ({
      onData(listener) { emitData = listener },
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
    const cookie = (await fetch(`${base}/api/auth`)).headers.get('set-cookie')?.split(';')[0] ?? ''
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Batched shell', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const { session } = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: TerminalSession }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach`, { headers: { cookie, origin: base } })
    const outputs: string[] = []
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; data?: string }
      if (message.type === 'output') outputs.push(message.data ?? '')
    })
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    emitData?.('a')
    emitData?.('b')
    emitData?.('c')
    await eventually(() => outputs.length === 1)
    assert.deepEqual(outputs, ['abc'])
    ws.close()
    await new Promise((resolve) => ws.once('close', resolve))
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('a PTY launch failure closes only the terminal connection and keeps the API alive', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-pty-failure-')))
  const tmux = fakeTmux()
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: () => { throw new Error('posix_spawnp failed') },
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const nodeResponse = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Broken shell', type: 'terminal', repoPath: root }),
    })
    const node = await nodeResponse.json() as { id: string }
    const sessionResponse = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    })
    const { session } = await sessionResponse.json() as { session: { id: string } }

    const webSocket = new WebSocket(`ws://127.0.0.1:${address.port}/api/sessions/${session.id}/attach`, {
      headers: { cookie, origin: base },
    })
    const closed = new Promise<number>((resolve) => webSocket.once('close', resolve))
    await closed

    const workspace = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } })
    assert.equal(workspace.status, 200)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('the real node-pty adapter attaches to tmux and streams shell output', {
  skip: process.platform === 'darwin' && process.env.CI
    ? 'GitHub macOS runners cannot allocate a node-pty Unix PTY reliably; run this on a local Mac for real tmux coverage.'
    : spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status !== 0,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-real-pty-')))
  const runtimeName = `muxmap-test-${process.pid}-${Date.now()}`
  const inheritedTmux = process.env.TMUX
  process.env.TMUX = '/tmp/map-services.sock,1,0'

  const session: TerminalSession = {
    id: `sess_${runtimeName}`,
    workspaceId: 'default',
    nodeId: 'test-node',
    name: `tmux:default:${runtimeName}`,
    runtimeName,
    backend: 'tmux',
    cwd: root,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  let pty: ReturnType<typeof defaultPtyFactory> | undefined

  try {
    realTmux.create(runtimeName, root)
    assert.equal(spawnSync('tmux', ['-L', 'default', 'has-session', '-t', runtimeName]).status, 0)
    const activePty = defaultPtyFactory(session)
    pty = activePty
    const mouse = spawnSync('tmux', ['-L', 'default', 'show-options', '-v', '-t', runtimeName, 'mouse'], { encoding: 'utf8' })
    assert.equal(mouse.stdout.trim(), 'on', 'browser terminals need tmux copy-mode scrolling')
    const marker = '__MUXMAP_REAL_PTY_OK__'
    const output = await new Promise<string>((resolve, reject) => {
      let received = ''
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for real PTY output: ${received}`)), 3000)
      activePty.onData((data) => {
        received += data
        if (received.split(marker).length > 2) {
          clearTimeout(timeout)
          resolve(received)
        }
      })
      activePty.write(`for i in {1..40}; do echo "history-$i"; done; printf '${marker}\\n'\r`)
    })
    assert.match(output, /__MUXMAP_REAL_PTY_OK__/)
    activePty.scroll(-3)
    activePty.scroll(-3)
    let scrollPosition = ''
    await eventually(() => {
      scrollPosition = spawnSync('tmux', ['-L', 'default', 'display-message', '-p', '-t', runtimeName, '#{pane_in_mode} #{scroll_position}'], { encoding: 'utf8' }).stdout.trim()
      return scrollPosition.startsWith('1 ')
    })
    assert.match(scrollPosition, /^1 /, 'scrolling must enter tmux history mode')
  } finally {
    if (inheritedTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = inheritedTmux
    pty?.kill()
    if (realTmux.exists(runtimeName)) realTmux.stop(runtimeName)
    rmSync(root, { recursive: true, force: true })
  }
})

test('tmux PTY fallback shell command safely quotes executable and args', () => {
  assert.equal(
    tmuxPtyFallbackCommand('/opt/homebrew/bin/tmux', ['-L', 'default', 'attach-session', '-t', "muxmap-default-jane's-task"]),
    `exec '/opt/homebrew/bin/tmux' '-L' 'default' 'attach-session' '-t' 'muxmap-default-jane'"'"'s-task'`,
  )
})

test('the real node-pty adapter reattaches to a persistent Zellij session', {
  skip: process.platform === 'win32' && process.env.CI
    ? 'Zellij 0.44.3 IPC is not usable in a non-interactive Windows Actions host'
    : spawnSync(zellijExecutable(), ['--version'], { stdio: 'ignore' }).status !== 0,
  timeout: 20_000,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-real-zellij-')))
  const runtimeName = `muxmap-zellij-test-${process.pid}-${Date.now()}`
  const session: TerminalSession = {
    id: `sess_${runtimeName}`,
    workspaceId: 'default',
    nodeId: 'test-zellij-node',
    name: `zellij:default:${runtimeName}`,
    runtimeName,
    backend: 'zellij',
    cwd: root,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  let pty: ReturnType<typeof defaultPtyFactory> | undefined

  const detach = (activePty: ReturnType<typeof defaultPtyFactory>) => new Promise<void>((resolve) => {
    activePty.onExit(resolve)
    activePty.kill()
  })

  const proveShell = (activePty: ReturnType<typeof defaultPtyFactory>, marker: string) => new Promise<string>((resolve, reject) => {
    const terminal = new Terminal({ cols: 100, rows: 30 })
    let received = ''
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for Zellij PTY output: ${received}`)), 8000)
    terminal.onData((data) => activePty.write(data))
    activePty.onData((data) => {
      received += data
      terminal.write(data)
      if (received.split(marker).length > 2) {
        clearTimeout(timeout)
        resolve(received)
      }
    })
    activePty.write(`echo ${marker}\r`)
  })

  try {
    pty = defaultPtyFactory(session)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await proveShell(pty, '__MUXMAP_ZELLIJ_FIRST__')
    await eventually(() => realZellij.exists(runtimeName), 5000)
    await detach(pty)
    pty = undefined
    await eventually(() => realZellij.exists(runtimeName), 5000)

    pty = defaultPtyFactory(session)
    await proveShell(pty, '__MUXMAP_ZELLIJ_REATTACHED__')
  } finally {
    if (pty) await detach(pty)
    if (realZellij.exists(runtimeName)) realZellij.stop(runtimeName)
    await eventually(() => !realZellij.exists(runtimeName), 5000)
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  assert.equal(realZellij.exists(runtimeName), false)
})

test('Windows accepts the MuxMap Zellij config', {
  skip: process.platform !== 'win32',
}, () => {
  const config = spawnSync(zellijExecutable(), ['--config', zellijConfigPath(), 'setup', '--check'], { encoding: 'utf8' })
  assert.equal(config.status, 0, config.stderr)
})

test('orphan tmux sessions can be adopted and node deletion explicitly keeps or stops tmux', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-orphan-api-')))
  const tmux = fakeTmux()
  tmux.live.add('muxmap-external-shell')
  tmux.live.add('muxmap-web')
  tmux.live.add('unrelated-shell')
  tmux.panes = () => [
    { runtimeName: 'muxmap-external-shell', paneId: '%1', pid: 900 },
    { runtimeName: 'muxmap-web', paneId: '%2', pid: 1000 },
  ]
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    processReader: () => [
      { pid: 900, ppid: 1, command: 'zsh' },
      { pid: 1000, ppid: 1, command: 'zsh' },
      { pid: 1001, ppid: 1000, command: 'node scripts/dev.mjs' },
      { pid: 1002, ppid: 1001, command: 'node --experimental-strip-types server/index.ts' },
    ],
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }

    const initial = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { orphans: Array<{ backend: string; runtimeName: string }>; selfHosting: Array<{ backend: string; runtimeName: string; role: string }> }
    assert.deepEqual(initial.orphans, [{ backend: 'tmux', runtimeName: 'muxmap-external-shell' }])
    assert.deepEqual(initial.selfHosting, [{ backend: 'tmux', runtimeName: 'muxmap-web', role: 'self_hosting' }])
    const protectedStop = await fetch(`${base}/api/sessions/stop-orphan`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', runtimeName: 'muxmap-web' }),
    })
    assert.equal(protectedStop.status, 400)
    assert.equal(tmux.live.has('muxmap-web'), true)

    const adoptNode = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Adopt target', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const adopted = await fetch(`${base}/api/sessions/adopt-orphan`, {
      method: 'POST', headers, body: JSON.stringify({ nodeId: adoptNode.id, backend: 'tmux', runtimeName: 'muxmap-external-shell' }),
    })
    assert.equal(adopted.status, 200)

    const orphanNode = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Keep shell', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const orphanSession = await fetch(`${base}/api/nodes/${orphanNode.id}/session`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { runtimeName: string } }
    const kept = await fetch(`${base}/api/nodes/${orphanNode.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ stopSession: false }),
    })
    assert.equal(kept.status, 200)
    assert.equal(tmux.live.has(orphanSession.session.runtimeName), true)

    const stopNode = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST', headers, body: JSON.stringify({ parentId: 'workspace', title: 'Stop shell', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const stoppedSession = await fetch(`${base}/api/nodes/${stopNode.id}/session`, {
      method: 'POST', headers, body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: { runtimeName: string } }
    const stopped = await fetch(`${base}/api/nodes/${stopNode.id}`, {
      method: 'DELETE', headers, body: JSON.stringify({ stopSession: true }),
    })
    assert.equal(stopped.status, 200)
    assert.equal(tmux.live.has(stoppedSession.session.runtimeName), false)

    const final = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { orphans: Array<{ runtimeName: string }> }
    assert.equal(final.orphans.some((orphan) => orphan.runtimeName === orphanSession.session.runtimeName), true)
    assert.equal(final.orphans.some((orphan) => orphan.runtimeName === 'unrelated-shell'), false)
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('local agent hooks update automatically detected tmux activity', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-agent-api-')))
  const tmux = fakeTmux()
  tmux.live.add('muxmap-codex-work')
  tmux.panes = () => [{ runtimeName: 'muxmap-codex-work', paneId: '%7', pid: 700 }]
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    requireBasicAuth: true,
    tmux,
    processReader: () => [
      { pid: 700, ppid: 1, command: 'bash' },
      { pid: 701, ppid: 700, command: 'node /usr/local/bin/codex' },
    ],
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const rejected = await fetch(`${base}/api/agent-events`, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'x-muxmap-hook': '1', 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(rejected.status, 403)

    const event = await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'UserPromptSubmit', session_id: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' } }),
    })
    assert.equal(event.status, 202)

    const auth = await fetch(`${base}/api/auth`, {
      headers: { authorization: `Basic ${Buffer.from('muxmap:test-token').toString('base64')}` },
    })
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const graph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as {
      orphans: Array<{ agent?: { kind: string; state: string; since?: string; externalSessionId?: string } }>
    }
    assert.equal(graph.orphans[0].agent?.kind, 'codex')
    assert.equal(graph.orphans[0].agent?.state, 'working')
    assert.equal(graph.orphans[0].agent?.externalSessionId, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
    assert.ok(graph.orphans[0].agent?.since)

    const completed = await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'Stop' } }),
    })
    assert.equal(completed.status, 202)
    const idlePrompt = await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'Notification', notification_type: 'idle_prompt' } }),
    })
    assert.equal(idlePrompt.status, 202)
    const lateSubagentStop = await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'SubagentStop', agent_id: 'agent-late' } }),
    })
    assert.equal(lateSubagentStop.status, 202)
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ parentId: 'workspace', title: 'Agent task', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const adopted = await fetch(`${base}/api/sessions/adopt-orphan`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: node.id, backend: 'tmux', runtimeName: 'muxmap-codex-work' }),
    }).then((response) => response.json()) as { session: TerminalSession }
    const unread = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    const unreadSession = unread.sessions.find((session) => session.id === adopted.session.id)
    assert.equal(unreadSession?.agent?.state, 'completed')
    assert.deepEqual(unreadSession?.agentEvents?.map((item) => item.eventName), ['SubagentStop', 'Notification', 'Stop', 'UserPromptSubmit'])
    assert.equal(Object.hasOwn(unreadSession!.agentEvents![0]!, 'payload'), false)
    assert.deepEqual(Object.keys(unreadSession!.agentEvents![0]!).sort(), ['createdAt', 'eventName', 'id', 'state'].sort())

    const acknowledged = await fetch(`${base}/api/sessions/${adopted.session.id}/agent/read`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: '{}',
    })
    assert.equal(acknowledged.status, 200)
    const read = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    assert.equal(read.sessions.find((session) => session.id === adopted.session.id)?.agent?.state, 'read')

    for (const state of ['working', 'delegated', 'completed', 'read'] as const) {
      const updated = await fetch(`${base}/api/sessions/${adopted.session.id}/agent/status`, {
        method: 'POST',
        headers: { cookie, origin: base, 'content-type': 'application/json' },
        body: JSON.stringify({ state }),
      }).then((response) => response.json()) as { activity: { state: string } }
      assert.equal(updated.activity.state, state)
    }
    const manuallyRead = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    const manualEvents = manuallyRead.sessions.find((item) => item.id === adopted.session.id)?.agentEvents ?? []
    assert.equal(manualEvents.length, 5)
    assert.equal(manualEvents.every((event) => !Object.hasOwn(event, 'payload')), true)
    assert.deepEqual(manualEvents.slice(0, 3).map((item) => [item.eventName, item.state]), [
      ['manual_status', 'read'],
      ['manual_status', 'completed'],
      ['manual_status', 'delegated'],
    ])
    const fullEvents = await fetch(`${base}/api/sessions/${adopted.session.id}/agent-events`, { headers: { cookie } }).then((response) => response.json()) as { events: Array<{ eventName: string; kind?: string; payload?: Record<string, unknown> }> }
    assert.ok(fullEvents.events.length > manualEvents.length)
    assert.equal(fullEvents.events[0]?.eventName, 'manual_status')
    assert.equal(fullEvents.events[0]?.kind, 'codex')
    assert.deepEqual(fullEvents.events[0]?.payload, { type: 'manual_status', state: 'read' })

    await fetch(`${base}/api/sessions/${adopted.session.id}/agent/status`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'working' }),
    })
    await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%7', event: { hook_event_name: 'Stop' } }),
    })
    const autoCompleted = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    assert.equal(autoCompleted.sessions.find((item) => item.id === adopted.session.id)?.agent?.state, 'completed')
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('Codex recovery recreates a missing tracked tmux session with codex resume', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'muxmap-codex-recover-api-')))
  const tmux = fakeTmux()
  const server = createMuxMapServer({
    databasePath: ':memory:',
    allowedRoots: [root],
    platform: 'linux',
    token: 'test-token',
    tmux,
    ptyFactory: fakePtyFactory({ writes: [], resizes: [], kills: [] }),
  })

  try {
    const address = await server.listen(0)
    const base = `http://127.0.0.1:${address.port}`
    const auth = await fetch(`${base}/api/auth`)
    const cookie = auth.headers.get('set-cookie')?.split(';')[0] ?? ''
    const headers = { cookie, origin: base, 'content-type': 'application/json' }
    const node = await fetch(`${base}/api/workspaces/default/nodes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ parentId: 'workspace', title: 'Recoverable Codex', type: 'terminal', repoPath: root }),
    }).then((response) => response.json()) as { id: string }
    const attached = await fetch(`${base}/api/nodes/${node.id}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ backend: 'tmux', cwd: root }),
    }).then((response) => response.json()) as { session: TerminalSession }
    tmux.panes = () => [{ runtimeName: attached.session.runtimeName, paneId: '%12', pid: 1200 }]
    await fetch(`${base}/api/agent-events`, {
      method: 'POST',
      headers: { 'x-muxmap-hook': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'codex', tmuxPane: '%12', event: { hook_event_name: 'UserPromptSubmit', session_id: '019fd54a-12a9-72c2-8a66-ee62fc1c546e' } }),
    })
    tmux.live.clear()
    const stoppedGraph = await fetch(`${base}/api/workspaces/default`, { headers: { cookie } }).then((response) => response.json()) as { sessions: TerminalSession[] }
    const stoppedSession = stoppedGraph.sessions.find((item) => item.id === attached.session.id)
    assert.equal(stoppedSession?.status, 'stopped')
    assert.equal(stoppedSession?.agent?.state, 'working')
    assert.equal(stoppedSession?.runtimeExists, false)
    assert.equal(stoppedSession?.canRecoverCodex, true)
    assert.equal(stoppedSession?.canRecoverAgent, true)

    const recovered = await fetch(`${base}/api/sessions/${attached.session.id}/recover-agent`, {
      method: 'POST',
      headers,
      body: '{}',
    }).then((response) => response.json()) as { session: TerminalSession }
    assert.equal(recovered.session.status, 'running')
    assert.deepEqual(tmux.createCommands.at(-1), ['codex', 'resume', '019fd54a-12a9-72c2-8a66-ee62fc1c546e'])
  } finally {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  }
})
