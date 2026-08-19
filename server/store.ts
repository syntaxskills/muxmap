import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  seedNodes,
  type NodeType,
  type AgentActivity,
  type AgentEventLogEntry,
  type TerminalBackend,
  type TerminalSession,
  type TerminalStatus,
  type WorkNode,
  type Workspace,
  type WorkspaceGraph,
} from '../src/model.ts'
import { reorderSiblings, type ReorderPosition } from '../src/graph.ts'
import { agentActivityFromRecordedEvent } from './agents.ts'

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

const nodeTypes: NodeType[] = ['workspace', 'repo', 'feature', 'ticket', 'note', 'todo', 'terminal']
const agentKinds: AgentEventLogEntry['kind'][] = ['codex', 'claude', 'pi']
const agentStates: AgentActivity['state'][] = ['unavailable', 'working', 'delegated', 'needs_input', 'completed', 'read']

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
      tmux_name, kind, state, since, external_session_id, external_session_path, external_cwd
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tmux_name) DO UPDATE SET
      kind = excluded.kind,
      state = excluded.state,
      since = excluded.since,
      external_session_id = COALESCE(excluded.external_session_id, agent_activity.external_session_id),
      external_session_path = COALESCE(excluded.external_session_path, agent_activity.external_session_path),
      external_cwd = COALESCE(excluded.external_cwd, agent_activity.external_cwd)
  `)
  for (const [runtimeName, activity] of latest) {
    upsert.run(
      runtimeName, activity.kind, activity.state, activity.since ?? new Date().toISOString(),
      activity.externalSessionId ?? null, activity.externalSessionPath ?? null, activity.externalCwd ?? null,
    )
  }
}

export function createStore(path: string) {
  const database = new DatabaseSync(path)
  database.exec(`
    PRAGMA foreign_keys = ON;
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
      external_session_id TEXT,
      external_session_path TEXT,
      external_cwd TEXT
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

  database.prepare("UPDATE agent_activity SET state = 'read' WHERE state = 'idle'").run()

  const agentColumns = database.prepare('PRAGMA table_info(agent_activity)').all() as Array<{ name: string }>
  for (const [column, type] of [['external_session_id', 'TEXT'], ['external_session_path', 'TEXT'], ['external_cwd', 'TEXT']] as const) {
    if (!agentColumns.some((item) => item.name === column)) database.exec(`ALTER TABLE agent_activity ADD COLUMN ${column} ${type}`)
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
      externalSessionId: row.external_session_id ? String(row.external_session_id) : undefined,
      externalSessionPath: row.external_session_path ? String(row.external_session_path) : undefined,
      externalCwd: row.external_cwd ? String(row.external_cwd) : undefined,
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

  return {
    getWorkspace(id: string): WorkspaceGraph {
      const row = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!row) throw new Error('Workspace not found')
      const nodes = database.prepare('SELECT * FROM nodes WHERE workspace_id = ? ORDER BY sort_order, created_at').all(id) as Record<string, unknown>[]
      const sessions = database.prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at').all(id) as Record<string, unknown>[]
      return { workspace: mapWorkspace(row), nodes: nodes.map(mapNode), sessions: sessions.map(mapSession) }
    },

    getNode(id: string) {
      const row = database.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? mapNode(row) : undefined
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
      return node
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
          tmux_name, kind, state, since, external_session_id, external_session_path, external_cwd
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tmux_name) DO UPDATE SET
          kind = excluded.kind,
          state = excluded.state,
          since = excluded.since,
          external_session_id = COALESCE(excluded.external_session_id, agent_activity.external_session_id),
          external_session_path = COALESCE(excluded.external_session_path, agent_activity.external_session_path),
          external_cwd = COALESCE(excluded.external_cwd, agent_activity.external_cwd)
      `).run(
        runtimeName, activity.kind, activity.state, activity.since ?? new Date().toISOString(),
        activity.externalSessionId ?? null, activity.externalSessionPath ?? null, activity.externalCwd ?? null,
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

    close() {
      database.close()
    },
  }
}

export type WorkspaceStore = ReturnType<typeof createStore>
