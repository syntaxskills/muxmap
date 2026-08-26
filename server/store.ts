import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  seedNodes,
  type NodeType,
  type AgentActivity,
  type AgentChannel,
  type AgentChannelRoute,
  type AgentChannelMessage,
  type AgentEventLogEntry,
  type NodeLifecycleStep,
  type NodeStepDefinition,
  type NodeStepKey,
  type NodeStepStatus,
  type TerminalBackend,
  type TerminalInputHistoryItem,
  type TerminalSession,
  type TerminalStatus,
  type WorkNode,
  type Workspace,
  type WorkspaceGraph,
} from '../src/model.ts'
import { reorderSiblings, type ReorderPosition } from '../src/graph.ts'
import { agentActivityFromRecordedEvent } from './agents.ts'
import { defaultNodeStepDefinitions, nodeStepKeys, normalizedNodeSteps } from '../src/nodeSteps.ts'
import { validateNodeStepDefinitions } from './config.ts'

type CreateNodeInput = {
  parentId: string
  title: string
  type: NodeType
  project?: string
  color?: string
  repoPath?: string
  jiraKey?: string
  note?: string
}

type UpdateNodeInput = Partial<Pick<WorkNode, 'title' | 'type' | 'project' | 'color' | 'repoPath' | 'jiraKey' | 'note'>> & { doneAt?: string | null }

type SessionInput = Omit<TerminalSession, 'createdAt' | 'updatedAt'>
type CreateAgentChannelInput = { sourceNodeId: string; targetNodeId: string; title?: string }
type CreateAgentChannelMessageInput = { authorNodeId: string; body: string; createdAt?: string; tokenCount?: number }
type UpdateNodeStepInput = { status?: unknown; ref?: unknown; url?: unknown; note?: unknown }

const nodeTypes: NodeType[] = ['workspace', 'repo', 'feature', 'ticket', 'note', 'todo', 'terminal']
const agentKinds: AgentEventLogEntry['kind'][] = ['codex', 'claude', 'pi']
const agentStates: AgentActivity['state'][] = ['unavailable', 'working', 'delegated', 'standby', 'needs_input', 'completed', 'read']
const nodeStepStatuses: NodeStepStatus[] = ['pending', 'done']
const nodeStepInputFields = ['status', 'ref', 'url', 'note'] as const

export class StoreValidationError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'StoreValidationError'
    this.statusCode = statusCode
  }
}

export function validateNodeStepKey(value: string, definitions: readonly NodeStepDefinition[] = defaultNodeStepDefinitions): NodeStepKey {
  if (!nodeStepKeys(definitions).includes(value)) throw new StoreValidationError('Invalid node step key')
  return value as NodeStepKey
}

function validateNodeStepInput(input: UpdateNodeStepInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StoreValidationError('Step body must be an object')
  for (const key of Object.keys(input)) {
    if (!(nodeStepInputFields as readonly string[]).includes(key)) throw new StoreValidationError(`Unknown step field: ${key}`)
  }
  if (!nodeStepStatuses.includes(input.status as NodeStepStatus)) throw new StoreValidationError('status must be pending or done')
  const output: { status: NodeStepStatus; ref?: string; url?: string; note?: string } = { status: input.status as NodeStepStatus }
  if (input.ref !== undefined) {
    if (typeof input.ref !== 'string') throw new StoreValidationError('ref must be a string')
    const ref = input.ref.trim()
    if (ref.length > 64) throw new StoreValidationError('ref must be 64 characters or fewer')
    if (ref) output.ref = ref
  }
  if (input.url !== undefined) {
    if (typeof input.url !== 'string') throw new StoreValidationError('url must be a string')
    const candidate = input.url.trim()
    if (candidate) {
      let parsed: URL
      try {
        parsed = new URL(candidate)
      } catch {
        throw new StoreValidationError('url must be an http(s) URL')
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new StoreValidationError('url must be an http(s) URL')
      output.url = candidate
    }
  }
  if (input.note !== undefined) {
    if (typeof input.note !== 'string') throw new StoreValidationError('note must be a string')
    const note = input.note.trim()
    if (note.length > 200) throw new StoreValidationError('note must be 200 characters or fewer')
    if (note) output.note = note
  }
  return output
}

function parsePayloadJson(value: unknown) {
  try {
    const parsed = JSON.parse(String(value))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Ignore malformed historical debug payloads.
  }
  return {}
}

function taskDescription(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const task = value as Record<string, unknown>
  for (const key of ['description', 'task_subject', 'subject', 'command', 'prompt']) {
    const candidate = task[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
}

function eventSummary(event: Record<string, unknown>, payload?: Record<string, unknown>) {
  const message = typeof event.message === 'string' ? event.message
    : typeof event.last_assistant_message === 'string' ? event.last_assistant_message
    : typeof event.task_subject === 'string' ? event.task_subject
    : typeof payload?.message === 'string' ? payload.message
    : typeof payload?.last_assistant_message === 'string' ? payload.last_assistant_message
    : typeof payload?.task_subject === 'string' ? payload.task_subject
    : undefined
  if (message) return message.replace(/\s+/g, ' ').trim().slice(0, 180)
  const backgroundTasks = Array.isArray(event.background_tasks) ? event.background_tasks : Array.isArray(payload?.background_tasks) ? payload.background_tasks : []
  const task = backgroundTasks.map(taskDescription).find(Boolean)
  if (task) return task.replace(/\s+/g, ' ').trim().slice(0, 180)
  const sessionCrons = Array.isArray(event.session_crons) ? event.session_crons : Array.isArray(payload?.session_crons) ? payload.session_crons : []
  const cron = sessionCrons.map(taskDescription).find(Boolean)
  return cron ? cron.replace(/\s+/g, ' ').trim().slice(0, 180) : undefined
}

function rebuildAgentActivityFromEvents(database: DatabaseSync) {
  const rows = database.prepare(`
    SELECT tmux_name, kind, state, payload_json, created_at
    FROM agent_events
    ORDER BY tmux_name, created_at, rowid
  `).all() as Array<Record<string, unknown>>
  const latest = new Map<string, AgentActivity>()
  for (const row of rows) {
    const runtimeName = String(row.tmux_name)
    const kind = String(row.kind)
    const state = String(row.state)
    if (!agentKinds.includes(kind as AgentEventLogEntry['kind']) || !agentStates.includes(state as AgentActivity['state'])) continue
    const next = agentActivityFromRecordedEvent(
      kind as AgentEventLogEntry['kind'],
      parsePayloadJson(row.payload_json),
      state as AgentActivity['state'],
      String(row.created_at),
      latest.get(runtimeName),
    )
    if (next) latest.set(runtimeName, next)
  }
  if (latest.size === 0) return
  const upsert = database.prepare(`
    INSERT INTO agent_activity (
      tmux_name, kind, state, since, standby_reason, external_session_id, external_session_path, external_cwd, messaging_protocol, messaging_socket
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmux_name) DO UPDATE SET
      kind = excluded.kind,
      state = excluded.state,
      since = excluded.since,
      standby_reason = excluded.standby_reason,
      external_session_id = COALESCE(excluded.external_session_id, agent_activity.external_session_id),
      external_session_path = COALESCE(excluded.external_session_path, agent_activity.external_session_path),
      external_cwd = COALESCE(excluded.external_cwd, agent_activity.external_cwd),
      messaging_protocol = COALESCE(excluded.messaging_protocol, agent_activity.messaging_protocol),
      messaging_socket = COALESCE(excluded.messaging_socket, agent_activity.messaging_socket)
  `)
  for (const [runtimeName, activity] of latest) {
    upsert.run(
      runtimeName, activity.kind, activity.state, activity.since ?? new Date().toISOString(),
      activity.standbyReason ?? null,
      activity.externalSessionId ?? null, activity.externalSessionPath ?? null, activity.externalCwd ?? null,
      activity.messagingProtocol ?? null, activity.messagingSocket ?? null,
    )
  }
}

function parseJsonRecord(value: unknown) {
  try {
    const parsed = JSON.parse(String(value))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Historical rows can contain empty defaults.
  }
  return {}
}

function estimateMessageTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function createStore(path: string, options: { nodeStepDefinitions?: readonly NodeStepDefinition[] } = {}) {
  let nodeStepDefinitions = options.nodeStepDefinitions?.length ? [...options.nodeStepDefinitions] : defaultNodeStepDefinitions
  const database = new DatabaseSync(path)
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_node_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      project TEXT,
      color TEXT NOT NULL,
      repo_path TEXT,
      jira_key TEXT,
      note TEXT,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS nodes_parent_order ON nodes(parent_id, sort_order);
    CREATE TABLE IF NOT EXISTS node_steps (
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      step_key TEXT NOT NULL,
      status TEXT NOT NULL,
      ref TEXT,
      url TEXT,
      note TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (node_id, step_key)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tmux_name TEXT NOT NULL UNIQUE,
      backend TEXT NOT NULL,
      cwd TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_attached_at TEXT,
      last_activity_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_activity (
      tmux_name TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      since TEXT NOT NULL,
      standby_reason TEXT,
      external_session_id TEXT,
      external_session_path TEXT,
      external_cwd TEXT,
      messaging_protocol TEXT,
      messaging_socket TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      tmux_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      event_name TEXT NOT NULL,
      state TEXT NOT NULL,
      notification_type TEXT,
      agent_type TEXT,
      agent_id TEXT,
      summary TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_events_runtime_created ON agent_events(tmux_name, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_channels (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      mcp_uri TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'muxmap-local',
      delivery_policy TEXT NOT NULL DEFAULT 'human-gated',
      message_limit INTEGER NOT NULL DEFAULT 50,
      token_warning_per_hour INTEGER NOT NULL DEFAULT 250000,
      token_hard_stop_per_hour INTEGER NOT NULL DEFAULT 500000,
      source_route_json TEXT NOT NULL DEFAULT '{}',
      target_route_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      closed_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_channels_workspace ON agent_channels(workspace_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_channel_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES agent_channels(id) ON DELETE CASCADE,
      author_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS agent_channel_messages_channel_created ON agent_channel_messages(channel_id, created_at);
    CREATE TABLE IF NOT EXISTS terminal_input_history (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      runtime_name TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS terminal_input_history_session_created ON terminal_input_history(session_id, created_at DESC);
  `)

  const nodeColumns = database.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>
  if (!nodeColumns.some((column) => column.name === 'archived_at')) {
    database.exec('ALTER TABLE nodes ADD COLUMN archived_at TEXT')
  }
  if (!nodeColumns.some((column) => column.name === 'done_at')) {
    database.exec('ALTER TABLE nodes ADD COLUMN done_at TEXT')
  }

  const sessionColumns = database.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  if (!sessionColumns.some((column) => column.name === 'last_activity_at')) {
    database.exec('ALTER TABLE sessions ADD COLUMN last_activity_at TEXT')
  }
  database.exec('UPDATE sessions SET last_activity_at = COALESCE(last_attached_at, created_at) WHERE last_activity_at IS NULL')

  const storedNodeSteps = database.prepare('SELECT value_json FROM app_config WHERE key = ?').get('nodeSteps') as Record<string, unknown> | undefined
  if (storedNodeSteps) {
    try {
      const parsed = JSON.parse(String(storedNodeSteps.value_json)) as unknown
      const result = validateNodeStepDefinitions(parsed)
      if (result.definitions) nodeStepDefinitions = result.definitions
    } catch {
      // Invalid persisted lifecycle config falls back to the startup config.
    }
  }

  database.prepare("UPDATE agent_activity SET state = 'read' WHERE state = 'idle'").run()

  const agentColumns = database.prepare('PRAGMA table_info(agent_activity)').all() as Array<{ name: string }>
  for (const [column, type] of [['standby_reason', 'TEXT'], ['external_session_id', 'TEXT'], ['external_session_path', 'TEXT'], ['external_cwd', 'TEXT'], ['messaging_protocol', 'TEXT'], ['messaging_socket', 'TEXT']] as const) {
    if (!agentColumns.some((item) => item.name === column)) database.exec(`ALTER TABLE agent_activity ADD COLUMN ${column} ${type}`)
  }

  const channelColumns = database.prepare('PRAGMA table_info(agent_channels)').all() as Array<{ name: string }>
  for (const [column, type] of [
    ['transport', "TEXT NOT NULL DEFAULT 'muxmap-local'"],
    ['delivery_policy', "TEXT NOT NULL DEFAULT 'human-gated'"],
    ['message_limit', 'INTEGER NOT NULL DEFAULT 50'],
    ['token_warning_per_hour', 'INTEGER NOT NULL DEFAULT 250000'],
    ['token_hard_stop_per_hour', 'INTEGER NOT NULL DEFAULT 500000'],
    ['source_route_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['target_route_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['closed_reason', 'TEXT'],
  ] as const) {
    if (!channelColumns.some((item) => item.name === column)) database.exec(`ALTER TABLE agent_channels ADD COLUMN ${column} ${type}`)
  }

  const channelMessageColumns = database.prepare('PRAGMA table_info(agent_channel_messages)').all() as Array<{ name: string }>
  if (!channelMessageColumns.some((column) => column.name === 'token_count')) {
    database.exec('ALTER TABLE agent_channel_messages ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0')
  }
  rebuildAgentActivityFromEvents(database)

  if (!database.prepare('SELECT id FROM workspaces WHERE id = ?').get('default')) {
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO workspaces (id, name, root_node_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('default', 'Engineering', 'workspace', now, now)

    const insert = database.prepare(`
      INSERT INTO nodes (
        id, workspace_id, parent_id, title, type, project, color, repo_path,
        jira_key, note, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const node of seedNodes) {
      insert.run(
        node.id, node.workspaceId, node.parentId, node.title, node.type,
        node.project ?? null, node.color, node.repoPath ? process.cwd() : null,
        node.jiraKey ?? null, node.note ?? null, node.sortOrder, now, now,
      )
    }
  }

  function mapWorkspace(row: Record<string, unknown>): Workspace {
    return {
      id: String(row.id),
      name: String(row.name),
      rootNodeId: String(row.root_node_id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  function mapNode(row: Record<string, unknown>): WorkNode {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      parentId: row.parent_id ? String(row.parent_id) : null,
      title: String(row.title),
      type: String(row.type) as NodeType,
      project: row.project ? String(row.project) : undefined,
      color: String(row.color),
      repoPath: row.repo_path ? String(row.repo_path) : undefined,
      jiraKey: row.jira_key ? String(row.jira_key) : undefined,
      note: row.note ? String(row.note) : undefined,
      sortOrder: Number(row.sort_order),
      doneAt: row.done_at ? String(row.done_at) : undefined,
      archivedAt: row.archived_at ? String(row.archived_at) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  function mapNodeStep(row: Record<string, unknown>): NodeLifecycleStep {
    const definition = nodeStepDefinitions.find((step) => step.key === row.step_key)
    return {
      key: String(row.step_key) as NodeStepKey,
      label: definition?.label ?? String(row.step_key),
      status: String(row.status) as NodeStepStatus,
      ref: row.ref ? String(row.ref) : undefined,
      url: row.url ? String(row.url) : undefined,
      note: row.note ? String(row.note) : undefined,
      updatedAt: String(row.updated_at),
      updatedBy: String(row.updated_by),
    }
  }

  function nodeStepsFromRows(rows: Record<string, unknown>[]): NodeLifecycleStep[] {
    return normalizedNodeSteps(rows.map(mapNodeStep), nodeStepDefinitions)
  }

  function listNodeStepsForNode(nodeId: string) {
    const rows = database.prepare('SELECT * FROM node_steps WHERE node_id = ?').all(nodeId) as Record<string, unknown>[]
    return nodeStepsFromRows(rows)
  }

  function nodeStepsByNodeId(nodeIds: string[]) {
    const steps = new Map<string, NodeLifecycleStep[]>()
    if (nodeIds.length === 0) return steps
    const placeholders = nodeIds.map(() => '?').join(', ')
    const rows = database.prepare(`SELECT * FROM node_steps WHERE node_id IN (${placeholders}) ORDER BY node_id`).all(...nodeIds) as Record<string, unknown>[]
    const grouped = new Map<string, Record<string, unknown>[]>()
    for (const row of rows) {
      const nodeId = String(row.node_id)
      const group = grouped.get(nodeId) ?? []
      group.push(row)
      grouped.set(nodeId, group)
    }
    for (const nodeId of nodeIds) steps.set(nodeId, nodeStepsFromRows(grouped.get(nodeId) ?? []))
    return steps
  }

  function seedInitializedStep(nodeId: string, now: string, updatedBy = 'system') {
    const firstStep = nodeStepDefinitions[0]
    if (!firstStep) return
    database.prepare(`
      INSERT INTO node_steps (node_id, step_key, status, ref, url, note, updated_at, updated_by)
      VALUES (?, ?, 'done', NULL, NULL, NULL, ?, ?)
      ON CONFLICT(node_id, step_key) DO NOTHING
    `).run(nodeId, firstStep.key, now, updatedBy)
  }

  function mapSession(row: Record<string, unknown>): TerminalSession {
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      nodeId: String(row.node_id),
      name: String(row.name),
      runtimeName: String(row.tmux_name),
      backend: String(row.backend) as TerminalBackend,
      cwd: String(row.cwd),
      status: String(row.status) as TerminalStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastAttachedAt: row.last_attached_at ? String(row.last_attached_at) : undefined,
      lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : undefined,
    }
  }

  function mapAgentActivity(row: Record<string, unknown>): AgentActivity {
    return {
      kind: String(row.kind) as AgentActivity['kind'],
      state: String(row.state) as AgentActivity['state'],
      since: String(row.since),
      standbyReason: row.standby_reason ? String(row.standby_reason) : undefined,
      externalSessionId: row.external_session_id ? String(row.external_session_id) : undefined,
      externalSessionPath: row.external_session_path ? String(row.external_session_path) : undefined,
      externalCwd: row.external_cwd ? String(row.external_cwd) : undefined,
      messagingProtocol: row.messaging_protocol === 'claude-cross-session' ? 'claude-cross-session' : undefined,
      messagingSocket: row.messaging_socket ? String(row.messaging_socket) : undefined,
    }
  }

  function mapAgentEvent(row: Record<string, unknown>): AgentEventLogEntry {
    let payload: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(String(row.payload_json))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>
    } catch {
      payload = {}
    }
    return {
      id: String(row.id),
      runtimeName: String(row.tmux_name),
      kind: String(row.kind) as AgentEventLogEntry['kind'],
      eventName: String(row.event_name),
      state: String(row.state) as AgentEventLogEntry['state'],
      notificationType: row.notification_type ? String(row.notification_type) : undefined,
      agentType: row.agent_type ? String(row.agent_type) : undefined,
      agentId: row.agent_id ? String(row.agent_id) : undefined,
      summary: row.summary ? String(row.summary) : undefined,
      payload,
      createdAt: String(row.created_at),
    }
  }

  function buildAgentChannelRoute(nodeId: string): AgentChannelRoute {
    const sessionRow = database.prepare('SELECT * FROM sessions WHERE node_id = ?').get(nodeId) as Record<string, unknown> | undefined
    const session = sessionRow ? mapSession(sessionRow) : undefined
    const activityRow = session ? database.prepare('SELECT * FROM agent_activity WHERE tmux_name = ?').get(session.runtimeName) as Record<string, unknown> | undefined : undefined
    const activity = activityRow ? mapAgentActivity(activityRow) : undefined
    const protocol = activity?.kind === 'claude' && activity.messagingProtocol === 'claude-cross-session' && activity.messagingSocket ? 'claude-cross-session' : 'muxmap-local'
    return {
      nodeId,
      ...(session ? { sessionId: session.id, runtimeName: session.runtimeName } : {}),
      ...(activity?.kind ? { kind: activity.kind } : {}),
      protocol,
      ...(protocol === 'claude-cross-session' ? { address: activity?.messagingSocket } : {}),
      ...(activity?.externalSessionId ? { externalSessionId: activity.externalSessionId } : {}),
      ...(activity?.externalCwd ?? session?.cwd ? { cwd: activity?.externalCwd ?? session?.cwd } : {}),
    }
  }

  function channelTransport(sourceRoute: AgentChannelRoute, targetRoute: AgentChannelRoute): AgentChannel['transport'] {
    if (sourceRoute.protocol === 'claude-cross-session' && targetRoute.protocol === 'claude-cross-session') return 'claude-cross-session-ready'
    return 'muxmap-local'
  }

  function mergeAgentChannelRoute(stored: Record<string, unknown>, live: AgentChannelRoute): AgentChannelRoute {
    const route = { ...stored, ...live } as AgentChannelRoute
    if (route.protocol !== 'claude-cross-session') delete route.address
    return route
  }

  function mapAgentChannel(row: Record<string, unknown>): AgentChannel {
    const sourceRoute = buildAgentChannelRoute(String(row.source_node_id))
    const targetRoute = buildAgentChannelRoute(String(row.target_node_id))
    const transport = channelTransport(sourceRoute, targetRoute)
    const storedSourceRoute = parseJsonRecord(row.source_route_json)
    const storedTargetRoute = parseJsonRecord(row.target_route_json)
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      sourceNodeId: String(row.source_node_id),
      targetNodeId: String(row.target_node_id),
      title: String(row.title),
      mcpUri: String(row.mcp_uri),
      transport,
      deliveryPolicy: 'human-gated',
      messageLimit: Number(row.message_limit ?? 50),
      sourceRoute: mergeAgentChannelRoute(storedSourceRoute, sourceRoute),
      targetRoute: mergeAgentChannelRoute(storedTargetRoute, targetRoute),
      tokenWarningPerHour: Number(row.token_warning_per_hour ?? 250000),
      tokenHardStopPerHour: Number(row.token_hard_stop_per_hour ?? 500000),
      status: String(row.status) as AgentChannel['status'],
      closedReason: row.closed_reason ? String(row.closed_reason) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }
  }

  function mapAgentChannelMessage(row: Record<string, unknown>): AgentChannelMessage {
    return {
      id: String(row.id),
      channelId: String(row.channel_id),
      authorNodeId: String(row.author_node_id),
      body: String(row.body),
      tokenCount: Number(row.token_count ?? estimateMessageTokens(String(row.body))),
      createdAt: String(row.created_at),
    }
  }

  function mapTerminalInputHistory(row: Record<string, unknown>): TerminalInputHistoryItem {
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      runtimeName: String(row.runtime_name),
      value: String(row.value),
      createdAt: String(row.created_at),
    }
  }

  return {
    getNodeStepDefinitions() {
      return [...nodeStepDefinitions]
    },

    updateNodeStepDefinitions(input: unknown) {
      const result = validateNodeStepDefinitions(input)
      if (result.errors.length || !result.definitions) throw new StoreValidationError(result.errors.join(' '), 400)
      nodeStepDefinitions = result.definitions
      database.prepare(`
        INSERT INTO app_config (key, value_json, updated_at)
        VALUES ('nodeSteps', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `).run(JSON.stringify(nodeStepDefinitions), new Date().toISOString())
      return [...nodeStepDefinitions]
    },

    getWorkspace(id: string): WorkspaceGraph {
      const row = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!row) throw new Error('Workspace not found')
      const nodes = database.prepare('SELECT * FROM nodes WHERE workspace_id = ? ORDER BY sort_order, created_at').all(id) as Record<string, unknown>[]
      const sessions = database.prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at').all(id) as Record<string, unknown>[]
      const channels = database.prepare('SELECT * FROM agent_channels WHERE workspace_id = ? AND status = ? ORDER BY created_at').all(id, 'open') as Record<string, unknown>[]
      const mappedNodes = nodes.map(mapNode)
      const steps = nodeStepsByNodeId(mappedNodes.map((node) => node.id))
      return { workspace: mapWorkspace(row), nodes: mappedNodes.map((node) => ({ ...node, steps: steps.get(node.id) })), sessions: sessions.map(mapSession), nodeStepDefinitions: [...nodeStepDefinitions], channels: channels.map(mapAgentChannel) }
    },

    createAgentChannel(workspaceId: string, input: CreateAgentChannelInput) {
      if (input.sourceNodeId === input.targetNodeId) throw new Error('Agent channel requires two distinct nodes')
      const source = this.getNode(input.sourceNodeId)
      const target = this.getNode(input.targetNodeId)
      if (!source || !target || source.workspaceId !== workspaceId || target.workspaceId !== workspaceId) throw new Error('Channel nodes must belong to the workspace')
      if (!this.getSessionByNode(source.id) || !this.getSessionByNode(target.id)) throw new Error('Both channel nodes need terminal sessions')
      const existing = database.prepare(`
        SELECT * FROM agent_channels
        WHERE workspace_id = ? AND status = 'open'
          AND ((source_node_id = ? AND target_node_id = ?) OR (source_node_id = ? AND target_node_id = ?))
      `).get(workspaceId, source.id, target.id, target.id, source.id) as Record<string, unknown> | undefined
      if (existing) return mapAgentChannel(existing)
      const now = new Date().toISOString()
      const id = randomUUID()
      const title = input.title?.trim() || `${source.title} ↔ ${target.title}`
      const mcpUri = `muxmap://agent-channels/${id}`
      const sourceRoute = buildAgentChannelRoute(source.id)
      const targetRoute = buildAgentChannelRoute(target.id)
      const transport = channelTransport(sourceRoute, targetRoute)
      database.prepare(`
        INSERT INTO agent_channels (
          id, workspace_id, source_node_id, target_node_id, title, mcp_uri, transport, delivery_policy,
          message_limit, token_warning_per_hour, token_hard_stop_per_hour, source_route_json, target_route_json,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, workspaceId, source.id, target.id, title, mcpUri, transport, 'human-gated',
        50, 250000, 500000, JSON.stringify(sourceRoute), JSON.stringify(targetRoute),
        'open', now, now,
      )
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, workspaceId)
      return this.getAgentChannel(id)!
    },

    getAgentChannel(id: string) {
      const row = database.prepare('SELECT * FROM agent_channels WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? mapAgentChannel(row) : undefined
    },

    deleteAgentChannel(id: string) {
      const channel = this.getAgentChannel(id)
      if (!channel) throw new Error('Agent channel not found')
      const now = new Date().toISOString()
      database.prepare('UPDATE agent_channels SET status = ?, closed_reason = ?, updated_at = ? WHERE id = ?').run('closed', 'Closed by user', now, id)
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, channel.workspaceId)
      return this.getAgentChannel(id)!
    },

    listAgentChannelMessages(channelId: string, limit = 80) {
      if (!this.getAgentChannel(channelId)) throw new Error('Agent channel not found')
      const rows = database.prepare('SELECT * FROM agent_channel_messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?').all(channelId, limit) as Record<string, unknown>[]
      return rows.map(mapAgentChannelMessage).reverse()
    },

    getAgentChannelUsage(channelId: string, timestamp = new Date().toISOString()) {
      const channel = this.getAgentChannel(channelId)
      if (!channel) throw new Error('Agent channel not found')
      const windowStart = new Date(new Date(timestamp).getTime() - 60 * 60 * 1000).toISOString()
      const row = database.prepare(`
        SELECT COUNT(*) AS message_count, COALESCE(SUM(token_count), 0) AS token_count
        FROM agent_channel_messages
        WHERE channel_id = ? AND created_at >= ?
      `).get(channelId, windowStart) as { message_count: number; token_count: number }
      return {
        windowSeconds: 3600,
        messageCount: Number(row.message_count),
        tokenCount: Number(row.token_count),
        messageLimit: channel.messageLimit,
        tokenWarningPerHour: channel.tokenWarningPerHour,
        tokenHardStopPerHour: channel.tokenHardStopPerHour,
        warning: Number(row.token_count) >= channel.tokenWarningPerHour,
        closed: channel.status === 'closed' || Number(row.token_count) >= channel.tokenHardStopPerHour || Number(row.message_count) >= channel.messageLimit,
      }
    },

    createAgentChannelMessage(channelId: string, input: CreateAgentChannelMessageInput) {
      const channel = this.getAgentChannel(channelId)
      if (!channel || channel.status !== 'open') throw new Error('Agent channel not found')
      const body = input.body.trim().slice(0, 4000)
      if (!body) throw new Error('Message body is required')
      if (![channel.sourceNodeId, channel.targetNodeId].includes(input.authorNodeId)) throw new Error('Message author must be part of the channel')
      const now = input.createdAt ?? new Date().toISOString()
      const tokenCount = Number.isFinite(input.tokenCount) && input.tokenCount && input.tokenCount > 0
        ? Math.ceil(input.tokenCount)
        : estimateMessageTokens(body)
      const usage = this.getAgentChannelUsage(channelId, now)
      const close = (reason: string) => {
        database.prepare('UPDATE agent_channels SET status = ?, closed_reason = ?, updated_at = ? WHERE id = ?').run('closed', reason, now, channelId)
        throw new Error(reason)
      }
      if (usage.messageCount >= channel.messageLimit) close('Agent channel hourly message limit reached')
      if (usage.tokenCount + tokenCount > channel.tokenHardStopPerHour) close('Agent channel hourly token limit reached')
      const id = randomUUID()
      database.prepare('INSERT INTO agent_channel_messages (id, channel_id, author_node_id, body, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, channelId, input.authorNodeId, body, tokenCount, now)
      database.prepare('UPDATE agent_channels SET updated_at = ? WHERE id = ?').run(now, channelId)
      return mapAgentChannelMessage(database.prepare('SELECT * FROM agent_channel_messages WHERE id = ?').get(id) as Record<string, unknown>)
    },

    getNode(id: string) {
      const row = database.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? mapNode(row) : undefined
    },

    getNodeSteps(id: string) {
      if (!this.getNode(id)) throw new StoreValidationError('Node not found', 404)
      return listNodeStepsForNode(id)
    },

    updateNodeStep(id: string, stepKey: string, input: UpdateNodeStepInput, updatedBy = 'user') {
      const node = this.getNode(id)
      if (!node) throw new StoreValidationError('Node not found', 404)
      const validKey = validateNodeStepKey(stepKey, nodeStepDefinitions)
      const validInput = validateNodeStepInput(input)
      const now = new Date().toISOString()
      database.prepare(`
        INSERT INTO node_steps (node_id, step_key, status, ref, url, note, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id, step_key) DO UPDATE SET
          status = excluded.status,
          ref = excluded.ref,
          url = excluded.url,
          note = excluded.note,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `).run(
        node.id, validKey, validInput.status,
        validInput.ref ?? null, validInput.url ?? null, validInput.note ?? null,
        now, updatedBy.trim() || 'user',
      )
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, node.workspaceId)
      return listNodeStepsForNode(node.id)
    },

    createNode(workspaceId: string, input: CreateNodeInput) {
      const title = input.title?.trim()
      if (!title) throw new Error('Node title is required')
      if (!nodeTypes.includes(input.type)) throw new Error('Invalid node type')
      const parent = this.getNode(input.parentId)
      if (!parent || parent.workspaceId !== workspaceId) throw new Error('Parent node not found')
      const next = database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM nodes WHERE parent_id = ?').get(parent.id) as { value: number }
      const now = new Date().toISOString()
      const node: WorkNode = {
        id: randomUUID(),
        workspaceId,
        parentId: parent.id,
        title,
        type: input.type,
        project: input.project ?? parent.project,
        color: input.color ?? parent.color,
        repoPath: input.repoPath ?? parent.repoPath,
        jiraKey: input.jiraKey,
        note: input.note,
        sortOrder: next.value,
        createdAt: now,
        updatedAt: now,
      }
      database.prepare(`
        INSERT INTO nodes (
          id, workspace_id, parent_id, title, type, project, color, repo_path,
          jira_key, note, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.id, node.workspaceId, node.parentId, node.title, node.type,
        node.project ?? null, node.color, node.repoPath ?? null,
        node.jiraKey ?? null, node.note ?? null, node.sortOrder, node.createdAt, node.updatedAt,
      )
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, workspaceId)
      seedInitializedStep(node.id, now)
      return { ...node, steps: listNodeStepsForNode(node.id) }
    },

    updateNode(id: string, input: UpdateNodeInput) {
      const existing = this.getNode(id)
      if (!existing) throw new Error('Node not found')
      const title = input.title === undefined ? existing.title : input.title.trim()
      const type = input.type ?? existing.type
      if (!title) throw new Error('Node title is required')
      if (!nodeTypes.includes(type)) throw new Error('Invalid node type')
      const now = new Date().toISOString()
      const updated: WorkNode = {
        ...existing,
        ...input,
        title,
        type,
        project: input.project === undefined ? existing.project : input.project.trim() || undefined,
        repoPath: input.repoPath === undefined ? existing.repoPath : input.repoPath.trim() || undefined,
        jiraKey: input.jiraKey === undefined ? existing.jiraKey : input.jiraKey.trim() || undefined,
        note: input.note === undefined ? existing.note : input.note.trim() || undefined,
        doneAt: input.doneAt === undefined ? existing.doneAt : input.doneAt?.trim() || undefined,
        updatedAt: now,
      }
      database.prepare(`
        UPDATE nodes SET title = ?, type = ?, project = ?, color = ?, repo_path = ?,
          jira_key = ?, note = ?, done_at = ?, updated_at = ? WHERE id = ?
      `).run(
        updated.title, updated.type, updated.project ?? null, updated.color,
        updated.repoPath ?? null, updated.jiraKey ?? null, updated.note ?? null,
        updated.doneAt ?? null,
        updated.updatedAt, updated.id,
      )
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, updated.workspaceId)
      return updated
    },

    reorderNode(id: string, targetId: string, position: ReorderPosition) {
      const node = this.getNode(id)
      const target = this.getNode(targetId)
      if (!node || !target) throw new Error('Node not found')
      if (!node.parentId || node.parentId !== target.parentId || node.id === target.id) throw new Error('Nodes must be distinct siblings')
      const rows = database.prepare('SELECT * FROM nodes WHERE parent_id = ? ORDER BY sort_order, created_at').all(node.parentId) as Record<string, unknown>[]
      const reordered = reorderSiblings(rows.map(mapNode), id, targetId, position).sort((a, b) => a.sortOrder - b.sortOrder)
      const update = database.prepare('UPDATE nodes SET sort_order = ?, updated_at = ? WHERE id = ?')
      const now = new Date().toISOString()
      database.exec('BEGIN')
      try {
        for (const sibling of reordered) update.run(sibling.sortOrder, now, sibling.id)
        database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, node.workspaceId)
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      return reordered.map((sibling) => ({ ...sibling, updatedAt: now }))
    },

    deleteNode(id: string) {
      const node = this.getNode(id)
      if (!node) throw new Error('Node not found')
      if (!node.parentId) throw new Error('Workspace root cannot be deleted')
      const rows = database.prepare(`
        WITH RECURSIVE branch(id) AS (
          SELECT id FROM nodes WHERE id = ?
          UNION ALL
          SELECT nodes.id FROM nodes JOIN branch ON nodes.parent_id = branch.id
        ) SELECT id FROM branch
      `).all(id) as Array<{ id: string }>
      database.prepare('DELETE FROM nodes WHERE id = ?').run(id)
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), node.workspaceId)
      return rows.map((row) => row.id)
    },

    archiveNode(id: string) {
      const node = this.getNode(id)
      if (!node) throw new Error('Node not found')
      if (!node.parentId) throw new Error('Workspace root cannot be archived')
      if (node.archivedAt) return node
      const now = new Date().toISOString()
      database.prepare('UPDATE nodes SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, node.workspaceId)
      return this.getNode(id)!
    },

    restoreNode(id: string) {
      const node = this.getNode(id)
      if (!node) throw new Error('Node not found')
      if (!node.archivedAt) return node
      const now = new Date().toISOString()
      database.prepare('UPDATE nodes SET archived_at = NULL, updated_at = ? WHERE id = ?').run(now, id)
      database.prepare('UPDATE workspaces SET updated_at = ? WHERE id = ?').run(now, node.workspaceId)
      return this.getNode(id)!
    },

    getSession(id: string) {
      const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? mapSession(row) : undefined
    },

    getSessionByNode(nodeId: string) {
      const row = database.prepare('SELECT * FROM sessions WHERE node_id = ?').get(nodeId) as Record<string, unknown> | undefined
      return row ? mapSession(row) : undefined
    },

    getSessionByRuntimeName(runtimeName: string) {
      const row = database.prepare('SELECT * FROM sessions WHERE tmux_name = ?').get(runtimeName) as Record<string, unknown> | undefined
      return row ? mapSession(row) : undefined
    },

    listSessions() {
      const rows = database.prepare('SELECT * FROM sessions ORDER BY created_at').all() as Record<string, unknown>[]
      return rows.map(mapSession)
    },

    getAgentActivity(runtimeName: string) {
      const row = database.prepare('SELECT * FROM agent_activity WHERE tmux_name = ?').get(runtimeName) as Record<string, unknown> | undefined
      return row ? mapAgentActivity(row) : undefined
    },

    upsertAgentActivity(runtimeName: string, activity: AgentActivity) {
      database.prepare(`
        INSERT INTO agent_activity (
          tmux_name, kind, state, since, standby_reason, external_session_id, external_session_path,
          external_cwd, messaging_protocol, messaging_socket
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tmux_name) DO UPDATE SET
          kind = excluded.kind,
          state = excluded.state,
          since = excluded.since,
          standby_reason = excluded.standby_reason,
          external_session_id = COALESCE(excluded.external_session_id, agent_activity.external_session_id),
          external_session_path = COALESCE(excluded.external_session_path, agent_activity.external_session_path),
          external_cwd = COALESCE(excluded.external_cwd, agent_activity.external_cwd),
          messaging_protocol = COALESCE(excluded.messaging_protocol, agent_activity.messaging_protocol),
          messaging_socket = COALESCE(excluded.messaging_socket, agent_activity.messaging_socket)
      `).run(
        runtimeName, activity.kind, activity.state, activity.since ?? new Date().toISOString(),
        activity.standbyReason ?? null,
        activity.externalSessionId ?? null, activity.externalSessionPath ?? null, activity.externalCwd ?? null,
        activity.messagingProtocol ?? null, activity.messagingSocket ?? null,
      )
      return this.getAgentActivity(runtimeName)!
    },

    recordAgentEvent(runtimeName: string, kind: AgentEventLogEntry['kind'], event: Record<string, unknown>, state: AgentActivity['state'], timestamp = new Date().toISOString()) {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : undefined
      const eventName = String(event.hook_event_name ?? event.hookEventName ?? event.type ?? event.event ?? payload?.hook_event_name ?? payload?.hookEventName ?? payload?.type ?? payload?.event ?? 'unknown')
      const notificationType = typeof event.notification_type === 'string' ? event.notification_type : typeof event.notificationType === 'string' ? event.notificationType : typeof payload?.notification_type === 'string' ? payload.notification_type : typeof payload?.notificationType === 'string' ? payload.notificationType : undefined
      const agentType = typeof event.agent_type === 'string' ? event.agent_type : typeof payload?.agent_type === 'string' ? payload.agent_type : undefined
      const agentId = typeof event.agent_id === 'string' ? event.agent_id : typeof event.agentId === 'string' ? event.agentId : typeof payload?.agent_id === 'string' ? payload.agent_id : typeof payload?.agentId === 'string' ? payload.agentId : undefined
      const summary = eventSummary(event, payload)
      database.prepare(`
        INSERT INTO agent_events (
          id, tmux_name, kind, event_name, state, notification_type, agent_type, agent_id, summary, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), runtimeName, kind, eventName, state, notificationType ?? null, agentType ?? null, agentId ?? null, summary ?? null, JSON.stringify(event), timestamp)
      database.prepare(`
        DELETE FROM agent_events
        WHERE tmux_name = ? AND id NOT IN (
          SELECT id FROM agent_events WHERE tmux_name = ? ORDER BY created_at DESC LIMIT 80
        )
      `).run(runtimeName, runtimeName)
    },

    listAgentEvents(runtimeName: string, limit = 20) {
      const rows = database.prepare('SELECT * FROM agent_events WHERE tmux_name = ? ORDER BY created_at DESC LIMIT ?').all(runtimeName, limit) as Record<string, unknown>[]
      return rows.map(mapAgentEvent)
    },

    upsertSession(input: SessionInput) {
      const existing = this.getSessionByNode(input.nodeId)
      const now = new Date().toISOString()
      const id = existing?.id ?? input.id
      const createdAt = existing?.createdAt ?? now
      database.prepare(`
        INSERT INTO sessions (
          id, workspace_id, node_id, name, tmux_name, backend, cwd, status,
          created_at, updated_at, last_attached_at, last_activity_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          name = excluded.name,
          tmux_name = excluded.tmux_name,
          backend = excluded.backend,
          cwd = excluded.cwd,
          status = excluded.status,
          updated_at = excluded.updated_at,
          last_attached_at = excluded.last_attached_at,
          last_activity_at = COALESCE(excluded.last_activity_at, sessions.last_activity_at)
      `).run(
        id, input.workspaceId, input.nodeId, input.name, input.runtimeName,
        input.backend, input.cwd, input.status, createdAt, now,
        input.lastAttachedAt ?? null, input.lastActivityAt ?? null,
      )
      return this.getSession(id)!
    },

    updateSessionStatus(id: string, status: TerminalStatus) {
      const now = new Date().toISOString()
      database.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
      return this.getSession(id)
    },

    updateSessionActivity(id: string, timestamp = new Date().toISOString()) {
      database.prepare(`
        UPDATE sessions SET last_activity_at = ?
        WHERE id = ? AND (last_activity_at IS NULL OR last_activity_at <= ?)
      `).run(timestamp, id, timestamp)
      return this.getSession(id)
    },

    updateSessionActivityByRuntimeName(runtimeName: string, timestamp = new Date().toISOString()) {
      database.prepare(`
        UPDATE sessions SET last_activity_at = ?
        WHERE tmux_name = ? AND (last_activity_at IS NULL OR last_activity_at <= ?)
      `).run(timestamp, runtimeName, timestamp)
      return this.getSessionByRuntimeName(runtimeName)
    },

    listTerminalInputHistory(sessionId: string, limit = 30) {
      const session = this.getSession(sessionId)
      if (!session) throw new Error('Session not found')
      const rows = database.prepare(`
        SELECT * FROM terminal_input_history
        WHERE session_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      `).all(sessionId, limit) as Record<string, unknown>[]
      return rows.map(mapTerminalInputHistory)
    },

    recordTerminalInput(sessionId: string, value: string) {
      const session = this.getSession(sessionId)
      if (!session) throw new Error('Session not found')
      const trimmed = value.trim()
      if (!trimmed) throw new Error('Input history value is required')
      const recent = this.listTerminalInputHistory(sessionId, 1)[0]
      if (recent?.value === trimmed) return recent
      const now = new Date().toISOString()
      const id = randomUUID()
      database.prepare('INSERT INTO terminal_input_history (id, session_id, runtime_name, value, created_at) VALUES (?, ?, ?, ?, ?)').run(id, sessionId, session.runtimeName, trimmed.slice(0, 4000), now)
      database.prepare(`
        DELETE FROM terminal_input_history
        WHERE session_id = ? AND id NOT IN (
          SELECT id FROM terminal_input_history WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100
        )
      `).run(sessionId, sessionId)
      this.updateSessionActivity(sessionId, now)
      return mapTerminalInputHistory(database.prepare('SELECT * FROM terminal_input_history WHERE id = ?').get(id) as Record<string, unknown>)
    },

    close() {
      database.close()
    },
  }
}

export type WorkspaceStore = ReturnType<typeof createStore>
