import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

type JsonRpcId = string | number | null
type JsonObject = Record<string, unknown>
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

type AdapterEnv = {
  MUXMAP_URL?: string
  MUXMAP_TOKEN?: string
  MUXMAP_WORKSPACE_ID?: string
  MUXMAP_NODE_ID?: string
}

type ToolDefinition = {
  name: string
  description: string
  inputSchema: JsonObject
}

const defaultMuxMapUrl = 'http://127.0.0.1:4782'
const defaultWorkspaceId = 'default'

const tools: ToolDefinition[] = [
  {
    name: 'muxmap_list_channels',
    description: 'List open MuxMap agent chat channels. If nodeId is omitted, MUXMAP_NODE_ID is used when available.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'MuxMap workspace id. Defaults to MUXMAP_WORKSPACE_ID or default.' },
        nodeId: { type: 'string', description: 'Optional node id to filter channels connected to this agent.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'muxmap_read_channel',
    description: 'Read recent messages from a human-created MuxMap agent chat channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel UUID or muxmap://agent-channels/<id> URI.' },
        limit: { type: 'number', description: 'Maximum messages to request. MuxMap currently caps server-side history.' },
      },
      required: ['channelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'muxmap_send_channel_message',
    description: 'Send a concise message to a MuxMap agent chat channel. Use files for large context and send paths or summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel UUID or muxmap://agent-channels/<id> URI.' },
        authorNodeId: { type: 'string', description: 'Author node id. Defaults to MUXMAP_NODE_ID.' },
        body: { type: 'string', description: 'Concise message body. Large context should be written to files first.' },
        tokenCount: { type: 'number', description: 'Optional caller-estimated token count for quota accounting.' },
      },
      required: ['channelId', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'muxmap_channel_usage',
    description: 'Inspect sliding one-hour message and token quota usage for a MuxMap agent chat channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel UUID or muxmap://agent-channels/<id> URI.' },
      },
      required: ['channelId'],
      additionalProperties: false,
    },
  },
  {
    name: 'muxmap_update_node_step',
    description: 'Update one fixed MuxMap node lifecycle step. After creating a Jira ticket or MR, call this with the ref and URL so the user can click through from the map. Example: {"stepKey":"ticket_created","ref":"OCI-2830","url":"https://jira.example/browse/OCI-2830"}.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'MuxMap node id. Defaults to MUXMAP_NODE_ID.' },
        stepKey: { type: 'string', enum: ['initialized', 'ticket_created', 'in_progress', 'mr_raised', 'finalized'] },
        status: { type: 'string', enum: ['pending', 'done'], default: 'done' },
        ref: { type: 'string', description: 'Short clickable label, for example OCI-2830 or !13595.' },
        url: { type: 'string', description: 'HTTP(S) link for the ref, for example Jira or GitLab MR URL.' },
        note: { type: 'string', description: 'Optional short note, max 200 chars.' },
      },
      required: ['stepKey'],
      additionalProperties: false,
    },
  },
  {
    name: 'muxmap_get_node_steps',
    description: 'Read the fixed 5-step MuxMap lifecycle status for a node. nodeId defaults to MUXMAP_NODE_ID.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'MuxMap node id. Defaults to MUXMAP_NODE_ID.' },
      },
      additionalProperties: false,
    },
  },
]

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError,
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function baseUrl(env: AdapterEnv) {
  return (env.MUXMAP_URL || defaultMuxMapUrl).replace(/\/+$/, '')
}

function workspaceId(env: AdapterEnv, input: JsonObject) {
  return typeof input.workspaceId === 'string' && input.workspaceId.trim()
    ? input.workspaceId.trim()
    : env.MUXMAP_WORKSPACE_ID || defaultWorkspaceId
}

function channelId(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('channelId is required')
  const trimmed = value.trim()
  const match = trimmed.match(/^muxmap:\/\/agent-channels\/([^/?#]+)$/)
  return match ? match[1] : trimmed
}

function authorNodeId(env: AdapterEnv, input: JsonObject) {
  const value = typeof input.authorNodeId === 'string' && input.authorNodeId.trim() ? input.authorNodeId.trim() : env.MUXMAP_NODE_ID
  if (!value) throw new Error('authorNodeId is required; pass it explicitly or set MUXMAP_NODE_ID')
  return value
}

function nodeId(env: AdapterEnv, input: JsonObject) {
  const value = typeof input.nodeId === 'string' && input.nodeId.trim() ? input.nodeId.trim() : env.MUXMAP_NODE_ID
  if (!value) throw new Error('nodeId is required; pass it explicitly or set MUXMAP_NODE_ID')
  return value
}

function authHeaders(env: AdapterEnv) {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (env.MUXMAP_TOKEN) headers.authorization = `Basic ${Buffer.from(`muxmap:${env.MUXMAP_TOKEN}`).toString('base64')}`
  return headers
}

async function muxmapCookie(fetchImpl: FetchLike, env: AdapterEnv) {
  const response = await fetchImpl(`${baseUrl(env)}/api/auth`, { headers: authHeaders(env) })
  if (!response.ok) throw new Error(`MuxMap authentication failed with ${response.status}`)
  return response.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function muxmapRequest(fetchImpl: FetchLike, env: AdapterEnv, path: string, init: RequestInit = {}) {
  const cookie = await muxmapCookie(fetchImpl, env)
  const headers = {
    ...authHeaders(env),
    ...(cookie ? { cookie } : {}),
    origin: baseUrl(env),
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...Object.fromEntries(new Headers(init.headers).entries()),
  }
  const response = await fetchImpl(`${baseUrl(env)}${path}`, { ...init, headers })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = asObject(payload).error
    throw new Error(typeof message === 'string' ? message : `MuxMap API returned ${response.status}`)
  }
  return payload
}

async function updatedByForNode(fetchImpl: FetchLike, env: AdapterEnv, targetNodeId: string) {
  try {
    const graph = asObject(await muxmapRequest(fetchImpl, env, `/api/workspaces/${encodeURIComponent(workspaceId(env, {}))}`))
    const sessions = Array.isArray(graph.sessions) ? graph.sessions : []
    const session = sessions.map(asObject).find((item) => item.nodeId === targetNodeId)
    return typeof session?.id === 'string' && session.id ? session.id : 'mcp'
  } catch {
    return 'mcp'
  }
}

export async function callMuxMapMcpTool(name: string, input: unknown, options: { env?: AdapterEnv; fetchImpl?: FetchLike } = {}) {
  const env = options.env ?? process.env
  const fetchImpl = options.fetchImpl ?? fetch
  const args = asObject(input)
  if (name === 'muxmap_list_channels') {
    const graph = asObject(await muxmapRequest(fetchImpl, env, `/api/workspaces/${encodeURIComponent(workspaceId(env, args))}`))
    const nodeId = typeof args.nodeId === 'string' && args.nodeId.trim() ? args.nodeId.trim() : env.MUXMAP_NODE_ID
    const channels = Array.isArray(graph.channels) ? graph.channels.filter((channel) => {
      if (!nodeId) return true
      const item = asObject(channel)
      return item.sourceNodeId === nodeId || item.targetNodeId === nodeId
    }) : []
    return textResult({ channels })
  }
  if (name === 'muxmap_read_channel') {
    const id = channelId(args.channelId)
    const path = `/api/agent-channels/${encodeURIComponent(id)}/messages`
    return textResult(await muxmapRequest(fetchImpl, env, path))
  }
  if (name === 'muxmap_send_channel_message') {
    const id = channelId(args.channelId)
    if (typeof args.body !== 'string') throw new Error('body is required')
    const body: JsonObject = { authorNodeId: authorNodeId(env, args), body: args.body }
    if (typeof args.tokenCount === 'number' && Number.isFinite(args.tokenCount)) body.tokenCount = args.tokenCount
    return textResult(await muxmapRequest(fetchImpl, env, `/api/agent-channels/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }))
  }
  if (name === 'muxmap_channel_usage') {
    const id = channelId(args.channelId)
    return textResult(await muxmapRequest(fetchImpl, env, `/api/agent-channels/${encodeURIComponent(id)}/usage`))
  }
  if (name === 'muxmap_update_node_step') {
    const targetNodeId = nodeId(env, args)
    if (typeof args.stepKey !== 'string' || !args.stepKey.trim()) throw new Error('stepKey is required')
    const body: JsonObject = { status: typeof args.status === 'string' && args.status.trim() ? args.status.trim() : 'done' }
    for (const key of ['ref', 'url', 'note'] as const) {
      if (typeof args[key] === 'string') body[key] = args[key]
    }
    const updatedBy = await updatedByForNode(fetchImpl, env, targetNodeId)
    return textResult(await muxmapRequest(fetchImpl, env, `/api/nodes/${encodeURIComponent(targetNodeId)}/steps/${encodeURIComponent(args.stepKey.trim())}`, {
      method: 'PUT',
      headers: { 'x-muxmap-updated-by': updatedBy },
      body: JSON.stringify(body),
    }))
  }
  if (name === 'muxmap_get_node_steps') {
    const targetNodeId = nodeId(env, args)
    return textResult(await muxmapRequest(fetchImpl, env, `/api/nodes/${encodeURIComponent(targetNodeId)}/steps`))
  }
  throw new Error(`Unknown tool: ${name}`)
}

function success(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function failure(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export async function handleMcpMessage(message: unknown, options: { env?: AdapterEnv; fetchImpl?: FetchLike } = {}) {
  const request = asObject(message)
  const id = (typeof request.id === 'string' || typeof request.id === 'number' || request.id === null) ? request.id : null
  const method = typeof request.method === 'string' ? request.method : ''
  const params = asObject(request.params)
  if (!method) return failure(id, -32600, 'Invalid JSON-RPC request')
  if (!('id' in request)) return undefined

  try {
    if (method === 'initialize') {
      const requestedVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : '2026-07-28'
      return success(id, {
        protocolVersion: requestedVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'muxmap-agent-channels', version: '0.1.0' },
      })
    }
    if (method === 'ping') return success(id, {})
    if (method === 'tools/list') return success(id, { tools })
    if (method === 'tools/call') {
      const toolName = typeof params.name === 'string' ? params.name : ''
      if (!toolName) return failure(id, -32602, 'Tool name is required')
      return success(id, await callMuxMapMcpTool(toolName, params.arguments, options))
    }
    if (method === 'resources/list') return success(id, { resources: [] })
    if (method === 'prompts/list') return success(id, { prompts: [] })
    return failure(id, -32601, `Method not found: ${method}`)
  } catch (error) {
    return success(id, textResult({ error: error instanceof Error ? error.message : String(error) }, true))
  }
}

export function runMcpStdio(options: { env?: AdapterEnv; fetchImpl?: FetchLike } = {}) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => {
    void (async () => {
      try {
        const response = await handleMcpMessage(JSON.parse(line), options)
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
      } catch (error) {
        process.stdout.write(`${JSON.stringify(failure(null, -32700, error instanceof Error ? error.message : 'Parse error'))}\n`)
      }
    })()
  })
}

if (fileURLToPath(import.meta.url) === process.argv[1]) runMcpStdio()
