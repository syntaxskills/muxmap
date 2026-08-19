export type NodeType =
  | 'workspace'
  | 'repo'
  | 'feature'
  | 'ticket'
  | 'note'
  | 'todo'
  | 'terminal'

export type WorkNode = {
  id: string
  workspaceId: string
  parentId: string | null
  title: string
  type: NodeType
  project?: string
  color: string
  repoPath?: string
  jiraKey?: string
  note?: string
  sortOrder: number
  doneAt?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export type TerminalStatus = 'running' | 'detached' | 'stopped' | 'error'
export type TerminalBackend = 'tmux' | 'zellij'

export type AgentKind = 'codex' | 'claude' | 'pi' | 'ssh'
export type AgentActivity = {
  kind: AgentKind
  state: 'unavailable' | 'working' | 'delegated' | 'needs_input' | 'completed' | 'read'
  since?: string
  externalSessionId?: string
  externalSessionPath?: string
  externalCwd?: string
}

export type AgentEventLogEntry = {
  id: string
  runtimeName: string
  kind: Exclude<AgentKind, 'ssh'>
  eventName: string
  state: AgentActivity['state']
  notificationType?: string
  agentType?: string
  agentId?: string
  summary?: string
  payload: Record<string, unknown>
  createdAt: string
}

export type TerminalSession = {
  id: string
  workspaceId: string
  nodeId: string
  name: string
  runtimeName: string
  backend: TerminalBackend
  cwd: string
  status: TerminalStatus
  createdAt: string
  updatedAt: string
  lastAttachedAt?: string
  lastActivityAt?: string
  agent?: AgentActivity
  agentEvents?: AgentEventLogEntry[]
  runtimeExists?: boolean
  canRecoverCodex?: boolean
}

export type Workspace = {
  id: string
  name: string
  rootNodeId: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceGraph = {
  workspace: Workspace
  nodes: WorkNode[]
  sessions: TerminalSession[]
  orphans?: Array<{ backend: TerminalBackend; runtimeName: string; agent?: AgentActivity }>
  runtime?: { platform: string; terminalBackends: TerminalBackend[] }
}

const seedTime = '2026-08-06T00:00:00.000Z'
const rawSeedNodes: Array<Omit<WorkNode, 'workspaceId' | 'createdAt' | 'updatedAt'>> = [
  {
    id: 'workspace',
    parentId: null,
    title: 'Engineering workspace',
    type: 'workspace',
    color: '#d39845',
    sortOrder: 0,
    note: 'Repos, active work, and execution context.',
  },
  {
    id: 'identity-service',
    parentId: 'workspace',
    title: 'Identity Service',
    type: 'repo',
    project: 'Identity',
    color: '#4f86c6',
    repoPath: '~/projects/identity-service',
    sortOrder: 0,
  },
  {
    id: 'authentication',
    parentId: 'identity-service',
    title: 'Authentication / Device Trust',
    type: 'feature',
    project: 'Identity',
    color: '#4f86c6',
    repoPath: '~/projects/identity-service',
    sortOrder: 0,
  },
  {
    id: 'dev-1420',
    parentId: 'authentication',
    title: 'DEV-1420 session expiry',
    type: 'ticket',
    project: 'Identity',
    color: '#4f86c6',
    repoPath: '~/projects/identity-service',
    jiraKey: 'DEV-1420',
    note: 'Handle expired sessions without losing in-progress work.',
    sortOrder: 0,
  },
  {
    id: 'dev-1457',
    parentId: 'authentication',
    title: 'DEV-1457 trusted device audit',
    type: 'ticket',
    project: 'Identity',
    color: '#4f86c6',
    repoPath: '~/projects/identity-service',
    jiraKey: 'DEV-1457',
    sortOrder: 1,
  },
  {
    id: 'profile-settings',
    parentId: 'identity-service',
    title: 'Profile Settings',
    type: 'feature',
    project: 'Identity',
    color: '#4f86c6',
    repoPath: '~/projects/identity-service',
    sortOrder: 1,
  },
  {
    id: 'billing-platform',
    parentId: 'workspace',
    title: 'Billing Platform',
    type: 'repo',
    project: 'Billing',
    color: '#a46bb4',
    repoPath: '~/projects/billing-platform',
    sortOrder: 1,
  },
  {
    id: 'webhook-delivery',
    parentId: 'billing-platform',
    title: 'Webhook Delivery',
    type: 'feature',
    project: 'Billing',
    color: '#a46bb4',
    repoPath: '~/projects/billing-platform',
    sortOrder: 0,
  },
  {
    id: 'reconciliation',
    parentId: 'billing-platform',
    title: 'Reconciliation',
    type: 'feature',
    project: 'Billing',
    color: '#a46bb4',
    repoPath: '~/projects/billing-platform',
    sortOrder: 1,
  },
  {
    id: 'shared-infra',
    parentId: 'workspace',
    title: 'Shared Infra',
    type: 'repo',
    project: 'Platform',
    color: '#4f9a7a',
    repoPath: '~/projects/shared-infra',
    sortOrder: 2,
  },
  {
    id: 'rotate-secrets',
    parentId: 'shared-infra',
    title: 'Rotate staging secrets',
    type: 'todo',
    project: 'Platform',
    color: '#4f9a7a',
    note: 'Coordinate after the deploy window.',
    sortOrder: 0,
  },
]

export const seedNodes: WorkNode[] = rawSeedNodes.map((node) => ({
  ...node,
  workspaceId: 'default',
  createdAt: seedTime,
  updatedAt: seedTime,
}))
