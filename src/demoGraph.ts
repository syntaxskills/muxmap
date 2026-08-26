import type { AgentActivity, AgentEventLogEntry, TerminalSession, WorkNode, WorkspaceGraph } from './model.ts'

const workspaceId = 'demo'
const now = '2026-08-19T10:00:00.000Z'

function node(input: Omit<WorkNode, 'workspaceId' | 'createdAt' | 'updatedAt' | 'color'> & { color?: string }): WorkNode {
  return {
    workspaceId,
    createdAt: now,
    updatedAt: now,
    color: input.color ?? '#5c8bc7',
    ...input,
  }
}

function event(runtimeName: string, kind: AgentEventLogEntry['kind'], eventName: string, state: AgentActivity['state'], createdAt: string, summary?: string): AgentEventLogEntry {
  return {
    id: `${runtimeName}-${eventName}-${createdAt}`,
    runtimeName,
    kind,
    eventName,
    state,
    summary,
    payload: { hook_event_name: eventName, ...(summary ? { message: summary } : {}) },
    createdAt,
  }
}

function session(input: Omit<TerminalSession, 'workspaceId' | 'createdAt' | 'updatedAt' | 'name' | 'runtimeName' | 'backend' | 'cwd'> & {
  runtimeName: string
  backend?: TerminalSession['backend']
  cwd?: string
}): TerminalSession {
  const { backend, runtimeName, cwd: inputCwd, ...rest } = input
  const cwd = inputCwd ?? '/Users/example/work/muxmap-demo'
  return {
    workspaceId,
    name: runtimeName,
    runtimeName,
    backend: backend ?? 'tmux',
    cwd,
    createdAt: '2026-08-19T08:00:00.000Z',
    updatedAt: rest.lastActivityAt ?? now,
    ...rest,
  }
}

export const demoWorkspaceGraph: WorkspaceGraph = {
  workspace: {
    id: workspaceId,
    name: 'MuxMap Agent Demo',
    rootNodeId: 'demo-workspace',
    createdAt: now,
    updatedAt: now,
  },
  runtime: { platform: 'darwin', terminalBackends: ['tmux', 'zellij'] },
  nodes: [
    node({ id: 'demo-workspace', parentId: null, title: 'Agent workflow demo', type: 'workspace', color: '#d39845', sortOrder: 0, note: 'Synthetic data for visual review, screenshots, and agent-state debugging.' }),
    node({ id: 'demo-product', parentId: 'demo-workspace', title: 'Product Platform', type: 'repo', color: '#4f86c6', project: 'Product', repoPath: '/Users/example/dev/product-platform', sortOrder: 0 }),
    node({ id: 'demo-infra', parentId: 'demo-workspace', title: 'Infrastructure Tools', type: 'repo', color: '#7b9c68', project: 'Infra', repoPath: '/Users/example/dev/infrastructure-tools', sortOrder: 1 }),
    node({ id: 'demo-research', parentId: 'demo-workspace', title: 'Research Notes', type: 'repo', color: '#a46bb4', project: 'Research', repoPath: '/Users/example/dev/research-notebooks', sortOrder: 2 }),

    node({ id: 'demo-auth', parentId: 'demo-product', title: 'Authentication and session continuity', type: 'feature', color: '#4f86c6', project: 'Product', repoPath: '/Users/example/dev/product-platform/services/authentication/session-continuity', sortOrder: 0 }),
    node({
      id: 'demo-api-contract',
      parentId: 'demo-auth',
      title: 'DEV-1842 preserve checkout context after identity provider redirect',
      type: 'ticket',
      color: '#4f86c6',
      project: 'Product',
      jiraKey: 'DEV-1842',
      repoPath: '/Users/example/dev/product-platform/services/authentication/session-continuity/src/server/redirect-handlers/provider-callback',
      note: 'Long metadata case: verify expanded nodes grow vertically, wrap path text, and keep the terminal preview readable beside agent status.',
      sortOrder: 0,
    }),
    node({
      id: 'demo-permission',
      parentId: 'demo-auth',
      title: 'Review browser permission prompt copy before release',
      type: 'todo',
      color: '#4f86c6',
      project: 'Product',
      jiraKey: 'DEV-1901',
      repoPath: '/Users/example/dev/product-platform/apps/web/src/features/permissions/prompts',
      note: 'Needs input marker should be obvious without taking over the whole node.',
      sortOrder: 1,
    }),
    node({
      id: 'demo-completed',
      parentId: 'demo-auth',
      title: 'Clean up flaky login regression harness',
      type: 'ticket',
      color: '#4f86c6',
      project: 'Product',
      jiraKey: 'DEV-1760',
      repoPath: '/Users/example/dev/product-platform/test/e2e/login-regression/harness',
      note: 'Completed-but-unread state should show the completed edge pulse and a jumping agent icon.',
      sortOrder: 2,
    }),

    node({ id: 'demo-observability', parentId: 'demo-infra', title: 'Local observability and developer telemetry', type: 'feature', color: '#7b9c68', project: 'Infra', repoPath: '/Users/example/dev/infrastructure-tools/packages/local-observer', sortOrder: 0 }),
    node({
      id: 'demo-background',
      parentId: 'demo-observability',
      title: 'Background test suite delegated to sub-agent',
      type: 'terminal',
      color: '#7b9c68',
      project: 'Infra',
      jiraKey: 'DEV-2017',
      repoPath: '/Users/example/dev/infrastructure-tools/packages/local-observer/examples/very/deep/path/for/background/subagent/results',
      note: 'Delegated means the foreground turn stopped, but a reported background task is still running. It should not look identical to working.',
      sortOrder: 0,
    }),
    node({
      id: 'demo-read',
      parentId: 'demo-observability',
      title: 'Document local hook event replay behavior',
      type: 'note',
      color: '#7b9c68',
      project: 'Infra',
      repoPath: '/Users/example/dev/infrastructure-tools/docs/agent-hooks/event-replay-and-state-rebuild',
      note: 'Read state is intentionally quiet after the user has opened the completed agent once.',
      sortOrder: 1,
    }),
    node({
      id: 'demo-standby',
      parentId: 'demo-observability',
      title: 'Published preview waiting for human review',
      type: 'terminal',
      color: '#7b9c68',
      project: 'Infra',
      repoPath: '/Users/example/dev/infrastructure-tools/packages/local-observer/previews/artifact-monitor',
      note: 'Standby means Claude left a passive artifact monitor armed and is waiting for a human action, not running compute.',
      sortOrder: 2,
    }),

    node({ id: 'demo-notes', parentId: 'demo-research', title: 'Terminal UX research clips and scrollback notes', type: 'feature', color: '#a46bb4', project: 'Research', repoPath: '/Users/example/dev/research-notebooks/terminal-ux/scrollback', sortOrder: 0 }),
    node({
      id: 'demo-long-note',
      parentId: 'demo-notes',
      title: 'Compare precise trackpad scrolling, source-link opening, and copied selection behavior across terminal emulators',
      type: 'note',
      color: '#a46bb4',
      project: 'Research',
      repoPath: '/Users/example/dev/research-notebooks/terminal-ux/scrollback/comparisons/macbook-trackpad/xterm-tmux-zellij-browser',
      note: 'This deliberately long note should wrap inside the expanded node instead of spilling out of the card. It also checks that auto-layout pushes siblings down when a hover expansion grows.',
      sortOrder: 0,
    }),
    node({ id: 'demo-archived-parent', parentId: 'demo-notes', title: 'Archived experiment branch', type: 'note', color: '#a46bb4', project: 'Research', note: 'Archived children should still be discoverable inside their parent.', sortOrder: 1, archivedAt: '2026-08-18T12:00:00.000Z' }),
    node({ id: 'demo-archived-child', parentId: 'demo-archived-parent', title: 'Old terminal layout draft', type: 'note', color: '#a46bb4', project: 'Research', sortOrder: 0 }),
  ],
  sessions: [
    session({
      id: 'demo-session-working',
      nodeId: 'demo-api-contract',
      runtimeName: 'muxmap-demo-claude-working',
      cwd: '/Users/example/dev/product-platform/services/authentication/session-continuity/src/server/redirect-handlers/provider-callback',
      status: 'running',
      lastActivityAt: '2026-08-19T09:58:00.000Z',
      agent: { kind: 'claude', state: 'working', since: '2026-08-19T09:43:00.000Z', externalSessionId: 'claude-demo-working-1842', externalCwd: '/Users/example/dev/product-platform/services/authentication/session-continuity' },
      agentEvents: [
        event('muxmap-demo-claude-working', 'claude', 'PreToolUse', 'working', '2026-08-19T09:58:00.000Z', 'Reading callback tests and preparing a focused patch.'),
        event('muxmap-demo-claude-working', 'claude', 'UserPromptSubmit', 'working', '2026-08-19T09:43:00.000Z', 'Implement redirect context preservation.'),
      ],
    }),
    session({
      id: 'demo-session-needs-input',
      nodeId: 'demo-permission',
      runtimeName: 'muxmap-demo-codex-needs-input',
      cwd: '/Users/example/dev/product-platform/apps/web/src/features/permissions/prompts',
      status: 'running',
      lastActivityAt: '2026-08-19T09:36:00.000Z',
      agent: { kind: 'codex', state: 'needs_input', since: '2026-08-19T09:36:00.000Z', externalSessionId: '0198-demo-needs-input' },
      agentEvents: [
        event('muxmap-demo-codex-needs-input', 'codex', 'PermissionRequest', 'needs_input', '2026-08-19T09:36:00.000Z', 'Approve browser fixture update before continuing.'),
      ],
    }),
    session({
      id: 'demo-session-completed',
      nodeId: 'demo-completed',
      runtimeName: 'muxmap-demo-pi-completed',
      cwd: '/Users/example/dev/product-platform/test/e2e/login-regression/harness',
      status: 'detached',
      lastActivityAt: '2026-08-19T08:51:00.000Z',
      agent: { kind: 'pi', state: 'completed', since: '2026-08-19T08:51:00.000Z', externalSessionId: 'pi-demo-completed-1760' },
      agentEvents: [
        event('muxmap-demo-pi-completed', 'pi', 'agent_end', 'completed', '2026-08-19T08:51:00.000Z', 'Regression harness cleanup completed.'),
      ],
    }),
    session({
      id: 'demo-session-delegated',
      nodeId: 'demo-background',
      runtimeName: 'muxmap-demo-claude-background',
      cwd: '/Users/example/dev/infrastructure-tools/packages/local-observer/examples/very/deep/path/for/background/subagent/results',
      status: 'running',
      lastActivityAt: '2026-08-19T09:12:00.000Z',
      agent: { kind: 'claude', state: 'delegated', since: '2026-08-19T09:12:00.000Z', externalSessionId: 'claude-demo-background-2017' },
      agentEvents: [
        event('muxmap-demo-claude-background', 'claude', 'Stop', 'delegated', '2026-08-19T09:12:00.000Z', 'Run npm test -- --runInBand in the background worker.'),
        event('muxmap-demo-claude-background', 'claude', 'TaskCreated', 'working', '2026-08-19T09:05:00.000Z', 'Delegate slow integration tests to a sub-agent.'),
      ],
    }),
    session({
      id: 'demo-session-read',
      nodeId: 'demo-read',
      runtimeName: 'muxmap-demo-codex-read',
      cwd: '/Users/example/dev/infrastructure-tools/docs/agent-hooks/event-replay-and-state-rebuild',
      status: 'detached',
      lastActivityAt: '2026-08-18T18:20:00.000Z',
      agent: { kind: 'codex', state: 'read', since: '2026-08-18T17:42:00.000Z', externalSessionId: '0198-demo-read' },
      agentEvents: [
        event('muxmap-demo-codex-read', 'codex', 'manual_status', 'read', '2026-08-18T18:20:00.000Z', 'User already reviewed this completed work.'),
      ],
    }),
    session({
      id: 'demo-session-standby',
      nodeId: 'demo-standby',
      runtimeName: 'muxmap-demo-claude-standby',
      cwd: '/Users/example/dev/infrastructure-tools/packages/local-observer/previews/artifact-monitor',
      status: 'detached',
      lastActivityAt: '2026-08-19T09:20:00.000Z',
      agent: { kind: 'claude', state: 'standby', since: '2026-08-19T09:20:00.000Z', standbyReason: 'live updates for artifact preview (auto-armed on publish)', externalSessionId: 'claude-demo-standby-2026' },
      agentEvents: [
        event('muxmap-demo-claude-standby', 'claude', 'Stop', 'standby', '2026-08-19T09:20:00.000Z', 'live updates for artifact preview (auto-armed on publish)'),
      ],
    }),
    session({
      id: 'demo-session-unavailable',
      nodeId: 'demo-long-note',
      runtimeName: 'muxmap-demo-ssh-unavailable',
      backend: 'zellij',
      cwd: '/Users/example/dev/research-notebooks/terminal-ux/scrollback/comparisons/macbook-trackpad/xterm-tmux-zellij-browser',
      status: 'running',
      lastActivityAt: '2026-08-16T21:10:00.000Z',
      agent: { kind: 'ssh', state: 'unavailable', since: '2026-08-16T21:10:00.000Z' },
    }),
  ],
  orphans: [
    { backend: 'tmux', runtimeName: 'muxmap-demo-orphan-claude', agent: { kind: 'claude', state: 'delegated', since: '2026-08-19T08:30:00.000Z', externalSessionId: 'claude-demo-orphan' } },
  ],
}
