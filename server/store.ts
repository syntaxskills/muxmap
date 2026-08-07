import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  seedNodes,
  type NodeType,
  type AgentActivity,
  type TerminalSession,
  type TerminalStatus,
  type WorkNode,
  type Workspace,
  type WorkspaceGraph,
} from '../src/model.ts'
import { reorderSiblings, type ReorderPosition } from '../src/graph.ts'

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

type UpdateNodeInput = Partial<Pick<WorkNode, 'title' | 'type' | 'project' | 'color' | 'repoPath' | 'jiraKey' | 'note'>>

type SessionInput = Omit<TerminalSession, 'createdAt' | 'updatedAt'>

const nodeTypes: NodeType[] = ['workspace', 'repo', 'feature', 'ticket', 'note', 'todo', 'terminal']

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
      last_attached_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_activity (
      tmux_name TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      since TEXT NOT NULL
    );
  `)

  database.prepare("UPDATE agent_activity SET state = 'read' WHERE state = 'idle'").run()

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
      tmuxName: String(row.tmux_name),
      backend: 'tmux',
      cwd: String(row.cwd),
      status: String(row.status) as TerminalStatus,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastAttachedAt: row.last_attached_at ? String(row.last_attached_at) : undefined,
    }
  }

  function mapAgentActivity(row: Record<string, unknown>): AgentActivity {
    return {
      kind: String(row.kind) as AgentActivity['kind'],
      state: String(row.state) as AgentActivity['state'],
      since: String(row.since),
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
        updatedAt: now,
      }
      database.prepare(`
        UPDATE nodes SET title = ?, type = ?, project = ?, color = ?, repo_path = ?,
          jira_key = ?, note = ?, updated_at = ? WHERE id = ?
      `).run(
        updated.title, updated.type, updated.project ?? null, updated.color,
        updated.repoPath ?? null, updated.jiraKey ?? null, updated.note ?? null,
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

    getSession(id: string) {
      const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? mapSession(row) : undefined
    },

    getSessionByNode(nodeId: string) {
      const row = database.prepare('SELECT * FROM sessions WHERE node_id = ?').get(nodeId) as Record<string, unknown> | undefined
      return row ? mapSession(row) : undefined
    },

    getSessionByTmuxName(tmuxName: string) {
      const row = database.prepare('SELECT * FROM sessions WHERE tmux_name = ?').get(tmuxName) as Record<string, unknown> | undefined
      return row ? mapSession(row) : undefined
    },

    listSessions() {
      const rows = database.prepare('SELECT * FROM sessions ORDER BY created_at').all() as Record<string, unknown>[]
      return rows.map(mapSession)
    },

    getAgentActivity(tmuxName: string) {
      const row = database.prepare('SELECT * FROM agent_activity WHERE tmux_name = ?').get(tmuxName) as Record<string, unknown> | undefined
      return row ? mapAgentActivity(row) : undefined
    },

    upsertAgentActivity(tmuxName: string, activity: AgentActivity) {
      database.prepare(`
        INSERT INTO agent_activity (tmux_name, kind, state, since) VALUES (?, ?, ?, ?)
        ON CONFLICT(tmux_name) DO UPDATE SET kind = excluded.kind, state = excluded.state, since = excluded.since
      `).run(tmuxName, activity.kind, activity.state, activity.since ?? new Date().toISOString())
      return this.getAgentActivity(tmuxName)!
    },

    upsertSession(input: SessionInput) {
      const existing = this.getSessionByNode(input.nodeId)
      const now = new Date().toISOString()
      const id = existing?.id ?? input.id
      const createdAt = existing?.createdAt ?? now
      database.prepare(`
        INSERT INTO sessions (
          id, workspace_id, node_id, name, tmux_name, backend, cwd, status,
          created_at, updated_at, last_attached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          name = excluded.name,
          tmux_name = excluded.tmux_name,
          cwd = excluded.cwd,
          status = excluded.status,
          updated_at = excluded.updated_at,
          last_attached_at = excluded.last_attached_at
      `).run(
        id, input.workspaceId, input.nodeId, input.name, input.tmuxName,
        input.backend, input.cwd, input.status, createdAt, now,
        input.lastAttachedAt ?? null,
      )
      return this.getSession(id)!
    },

    updateSessionStatus(id: string, status: TerminalStatus) {
      const now = new Date().toISOString()
      database.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
      return this.getSession(id)
    },

    close() {
      database.close()
    },
  }
}

export type WorkspaceStore = ReturnType<typeof createStore>
