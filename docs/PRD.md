# MuxMap PRD + Technical Design

## 1. Product Summary

**MuxMap** is a compact, local-first mindmap workspace for developers to organize repos, features, tickets, notes, coding agents, and persistent terminal sessions.

The core idea:

> The mindmap is the main interface. Terminal is an optional capability attached to specific nodes.

A user can create a workspace like:

```text
Workspace
├── Atlas API
│   ├── Authentication / Device Trust
│   │   ├── DEV-1420 session expiry
│   │   └── DEV-1457 trusted device audit
│   └── Profile Settings
├── Billing Platform
│   ├── Webhook Delivery
│   └── Reconciliation
└── Shared Infra
```

Some nodes are just mindmap nodes. Some nodes are backed by a persistent tmux or Zellij session through PTY. Closing the webpage detaches the browser; it does not stop the terminal session.

---

# PRD

## 2. Problem

Developers work across many fragmented contexts:

* Multiple repos
* Multiple Jira tickets
* Multiple terminal sessions
* Multiple local coding agents
* Notes / TODOs
* Branches, commands, logs, test runs

Current tools do not give a good spatial overview of this work. `tmux` is powerful, but it is hard to understand what each session belongs to. Jira knows tickets but not terminal state. Notes know intent but not execution context.

MuxMap solves this by making the work structure visible as a compact mindmap, while allowing any node to become executable by attaching a persistent terminal session and surfacing local agent state.

---

## 3. Target Users

Primary users:

* Software engineers working across multiple repos and tickets
* Developers who frequently use terminal, `tmux`, Jira, and local dev environments
* Engineers who need to switch context quickly without losing terminal state

Secondary users:

* Tech leads reviewing project structure
* QA / SDET users organizing test scenarios
* AI coding agent users who want structured repo/ticket/session context

---

## 4. Product Principles

### Mindmap First

MuxMap is not a terminal with a sidebar.
It is a mindmap where terminal can be attached to selected nodes.

### Compact by Default

The graph should support dozens of nodes.
Default nodes should be small, readable, and color-coded.
Hover reveals detail. Click opens the side panel.

### Terminal Is Optional

Root, repo, feature, ticket, and note nodes do not always need terminal sessions.
A terminal appears only when a node has a session attached.

### Agents Are Context, Not the Primary UI

Agent state belongs to the node that owns the terminal. MuxMap should show whether a local agent is working, done, waiting for input, read, or unavailable without forcing a separate agent dashboard.

### Persistent Sessions

Closing or refreshing the browser must not kill the terminal.
The browser is only a client.
The backend owns the session lifecycle.

### Auto Layout

New nodes should be automatically placed into a clean tree layout.
Users should not need to manually clean up the graph after every node creation.

### Archive Instead of Losing Context

Completed work should be removable from the active map without being destroyed. Archived nodes remain searchable under their original parent hierarchy and can be restored or permanently deleted later.

---

## 5. Core User Flows

### Flow 1: Open Workspace

1. User opens MuxMap.
2. System loads the saved workspace graph.
3. User sees repos, features, tickets, and notes in a compact mindmap.
4. Nodes with terminal sessions show a terminal badge.
5. User clicks a node to inspect it.

Success: user understands current work structure at a glance.

---

### Flow 2: Create a Jira Ticket Node

1. User selects a feature node, such as `Authentication / Device Trust`.
2. User clicks the node's `+` control.
3. MuxMap creates a child node inline and focuses its title.
4. User types `DEV-1420 session expiry` and presses Enter.
5. The graph automatically re-layouts; type and metadata remain user-editable in the detail panel.

Success: the new ticket is organized neatly without manual positioning.

---

### Flow 3: Attach Terminal to a Node

1. User selects `DEV-1420 session expiry`.
2. User clicks `Attach terminal`.
3. Backend creates or reuses a deterministic terminal runtime such as `muxmap-default-DEV-1420`.
4. Node gets a terminal badge.
5. The workspace becomes a roughly 50/50 mindmap-and-terminal split and connects to that session.

Success: user can run commands in the correct ticket/repo context.

---

### Flow 4: Reopen Workspace

1. User closes the browser.
2. Backend keeps terminal sessions alive.
3. User reopens MuxMap.
4. User clicks the same terminal-enabled node.
5. MuxMap reattaches to the existing session.

Success: browser close does not destroy work.

### Flow 5: Manage Orphan Sessions

1. User opens the session inventory from the workspace header.
2. MuxMap lists live `muxmap*` terminal sessions that are not linked to a node.
3. User attaches an orphan to the selected node, creates a root terminal node for it, or stops it.
4. When deleting a node, the user explicitly chooses whether its terminal session remains as an orphan or stops with the node.

Success: MuxMap-owned terminal sessions remain visible and controllable without accidental termination.

### Flow 6: Archive Completed Work

1. User finishes a branch or node.
2. User chooses `Archive`.
3. MuxMap hides it from the active mindmap while preserving parent relationships, metadata, terminal session links, and searchability.
4. User can restore it later from the archive panel, or permanently delete it with confirmation.

Success: finished work stops cluttering the active workspace but remains recoverable.

### Flow 7: Review Agent Attention

1. User starts Codex, Claude Code, Pi, or SSH work inside a MuxMap terminal.
2. Agent hooks or process detection update the linked node.
3. Active work animates the node, completed work jumps the agent icon, and input requests show an attention marker.
4. Clicking the notification or node opens the relevant terminal and marks completed work read.

Success: user can see which terminals need attention without polling each shell manually.

---

## 6. MVP Features

### Mindmap Canvas

Required:

* Compact left-to-right mindmap
* Workspace → repo → feature → ticket/note hierarchy
* Color-coded projects
* Terminal badge for session-enabled nodes
* Hover to reveal details
* Click to select node
* Zoom in / zoom out / fit view
* Unbounded drag-to-pan canvas and center control
* Automatic layout after node creation
* Contextual `+` control for inline child creation and direct node renaming
* Hover expansion inline inside the node, with surrounding nodes reflowing smoothly
* Click-to-pin expanded node details
* Sibling reorder by dragging within the tree, without arbitrary manual placement
* Archive counts for parents with archived children

### Node Types

| Type          | Purpose                | Terminal Default |
| ------------- | ---------------------- | ---------------- |
| Workspace     | Root of the graph      | No               |
| Repo          | Codebase or project    | Optional         |
| Feature       | Functional area        | Optional         |
| Jira Ticket   | Concrete work item     | Optional         |
| Note / TODO   | Plain context or task  | No               |
| Terminal Task | Execution-focused task | Yes              |

Default node type is visually quiet. Users can still set a type, but the type should not dominate the map.

### Node Detail Panel

When a node is selected, show:

* Title
* Type
* Project
* Repo path
* Jira key
* Note
* Terminal session status
* Editable title, type, project, repository path, ticket key, and note
* Attach terminal button if no terminal exists
* Compact terminal preview if terminal exists
* Archived children under the selected parent
* Node color presets with inherited child colors and optional custom color

### Terminal Workspace Window

Required:

* Browser terminal UI
* Connect to backend session
* Send input
* Receive output
* Reattach after refresh
* Do not kill session on browser close
* Open docked on the right at roughly 50/50 with the mindmap still visible
* Resize the split with a draggable divider and persist the ratio in the browser
* Float into a draggable, resizable window, dock it again, or toggle full-screen/restore
* Expand from a compact terminal preview in the selected node panel
* Visually identify and highlight the linked node
* Configure terminal window opacity in persistent global settings
* Do not translate trackpad scrolling into up/down terminal input
* Preserve terminal scrollback navigation and text selection/copy
* Support terminal link click-through for browser URLs and local development URLs
* Support common macOS word/line navigation keys inside the terminal
* Closing the window detaches the browser without stopping the terminal runtime
* React lifecycle cleanup detaches the discarded client without marking the live replacement connection stopped

### Session Inventory

Required:

* Discover live tmux/Zellij sessions whose names start with `muxmap`
* Distinguish node-linked sessions from orphans
* Attach an orphan to the selected node
* Create a root terminal node for an orphan
* Explicitly stop a linked or orphan terminal session
* On node deletion, choose between keeping the terminal as an orphan and stopping it
* Avoid duplicate runtime-name collisions when two nodes share the same title

### Archive

Required:

* Archive active nodes and branches without deleting them.
* Stop live terminal sessions when their node or branch is archived.
* Keep archived nodes under their original parent context.
* Preserve nested archived children when the parent is restored.
* Search archived nodes by title, ticket, project, or note.
* Restore archived nodes.
* Permanently delete archived nodes or branches with confirmation.
* When deleting archived content, explicitly choose whether live sessions stop or become orphans.

### Settings

Required:

* Dedicated settings panel, not stacked inside the terminal surface.
* Compact UI organized by category.
* JSON editor that accepts partial overrides and formats effective settings.
* Platform-aware terminal backend choices: tmux on macOS/Linux, Zellij on Windows.
* Notification delivery controls for system-only, in-page-only, both, or off.
* Browser notification test action.
* Persist settings in the browser and migrate old settings safely.

### Mobile

Required:

* Responsive mindmap layout for phone width.
* Terminal opens from the bottom as an approximately 80% sheet.
* Safe-area aware controls.
* Compact detail and archive panels.
* Touch-friendly map panning, zooming, and node actions.

### Agent Activity

Required:

* Detect Codex, Claude Code, Pi, and SSH when running under MuxMap-managed terminals.
* Accept local lifecycle hooks for working, needs-input, completed, read, and unavailable states.
* Keep hook failure isolated from the agent process; hooks must exit successfully even when MuxMap is unavailable.
* Avoid high-frequency filesystem session scans.
* Show last activity age on linked nodes using compact labels such as `1M`, `55M`, `2H`, `36H`, and `3d`.
* Route attention through in-page notifications, system notifications, or both based on settings.

### Agent Channels

Required:

* A human can manually connect two terminal-backed nodes into an agent channel.
* Channels are shown on the main mindmap without changing the tree hierarchy.
* Channel records persist in SQLite with a stable `muxmap://agent-channels/<id>` URI.
* Channel message APIs exist for MCP/local-tool adapters, but agents do not auto-chat unless the user creates the channel.
* Channel messages are bounded by a sliding quota: default 50 messages/hour, warning at 250k estimated tokens/hour, and hard close before 500k estimated tokens/hour.
* MCP adapters should keep channel messages concise and use files for large context, sending only summaries or paths through the channel.
* Claude Code cross-session and A2A concepts can inform routing metadata, but MuxMap channels must still work through the local MuxMap channel when those transports are unavailable.

### Voice-Friendly Terminal Input

Required:

* A custom input box is available next to the browser terminal for dictated or edited commands.
* Submitting the box sends text to the current terminal session.
* Input history is stored by MuxMap per session and can be recalled without writing into shell history.

---

## 7. Non-MVP

Not required initially:

* Jira sync
* GitHub / GitLab integration
* Multiplayer collaboration
* AI agent automation
* Manual layout persistence
* Cloud sandbox provisioning
* Full tmux pane/window UI
* Team permission model

---

## 8. UX Requirements

Default graph view:

* Nodes are compact, not large cards.
* Titles should remain visible.
* Metadata should be hidden until hover or click.
* Project color should be visible.
* Terminal-enabled nodes should have a clear badge.

Hover state:

* Show full title
* Type
* Project
* Path
* Jira ticket
* Terminal status
* Note

Click state:

* Select node
* Show details in side panel
* Open the terminal workspace window in one click if the node has a session
* Double-click the node title to rename it in place

---

## 9. Success Metrics

MVP is successful if:

* User can manage 40+ nodes without visual overload.
* User can find a Jira ticket quickly.
* User can attach terminal to any node.
* Refreshing the page does not kill sessions.
* Switching between ticket terminals takes one click.
* Newly created nodes are automatically organized.

---

# Technical Design

## 10. Architecture

```text
Browser UI
├── Mindmap canvas
├── Node detail panel
└── Web terminal client

Backend Server
├── Workspace graph API
├── Session registry
├── WebSocket terminal gateway
└── tmux / Zellij / PTY adapter

Execution Layer
├── tmux sessions, macOS/Linux
├── Zellij sessions, Windows
├── local shell
├── remote shell, optional later
└── sandbox backend, optional later
```

Recommended MVP stack:

* Frontend: React + TypeScript
* Mindmap: SVG first, Canvas later if needed
* Terminal: xterm.js
* Backend: Node.js
* Terminal process: `tmux` on macOS/Linux or Zellij 0.44.3+ on Windows, bridged by `node-pty`
* Persistence: SQLite
* Transport: WebSocket

---

## 11. Data Model

### Workspace

```ts
type Workspace = {
  id: string;
  name: string;
  rootNodeId: string;
  createdAt: string;
  updatedAt: string;
};
```

### Node

```ts
type WorkNode = {
  id: string;
  workspaceId: string;
  parentId: string | null;

  title: string;
  type: "workspace" | "repo" | "feature" | "ticket" | "note" | "todo" | "terminal";

  project?: string;
  color?: string;
  repoPath?: string;
  jiraKey?: string;
  note?: string;

  sortOrder: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Terminal Session

```ts
type TerminalSession = {
  id: string;
  workspaceId: string;
  nodeId: string;

  name: string; // example: tmux:DEV-1420
  backend: "tmux" | "zellij";
  cwd?: string;

  status: "running" | "detached" | "stopped" | "error";

  createdAt: string;
  updatedAt: string;
  lastAttachedAt?: string;
  lastActivityAt?: string;
};
```

### Agent Activity

```ts
type AgentActivity = {
  runtimeName: string;
  kind: "codex" | "claude" | "pi" | "ssh";
  state: "working" | "needs_input" | "completed" | "read" | "unavailable";
  since: string;
  lastActivityAt?: string;
  externalSessionId?: string;
};
```

---

## 12. API Design

### Get Workspace

```http
GET /api/workspaces/:workspaceId
```

Returns workspace, nodes, and session metadata.

### Create Node

```http
POST /api/workspaces/:workspaceId/nodes
```

Request:

```json
{
  "parentId": "feat-login",
  "title": "DEV-1420 session expiry",
  "type": "ticket",
  "repoPath": "~/projects/atlas-api/services/auth",
  "jiraKey": "DEV-1420",
  "attachTerminal": false
}
```

### Update Node

```http
PATCH /api/nodes/:nodeId
```

Updates user-editable title, type, project, repository path, Jira key, note, or color without changing tree hierarchy.

### Attach Terminal

```http
POST /api/nodes/:nodeId/session
```

Request:

```json
{
  "backend": "tmux",
  "cwd": "~/projects/atlas-api/services/auth"
}
```

On Windows, `zellij` is the only selectable backend. On macOS/Linux, `tmux` is the default and Zellij can be selected when available.

Response:

```json
{
  "session": {
    "id": "sess_123",
    "name": "tmux:DEV-1420",
    "status": "running"
  }
}
```

### Stop Session

```http
POST /api/sessions/:sessionId/stop
```

Important: stopping a session must be explicit.
WebSocket disconnect or browser close must not stop the session.

---

## 13. WebSocket Terminal Protocol

```text
WS /api/sessions/:sessionId/attach
```

Client messages:

```ts
type ClientMessage =
  | { type: "input"; data: string }
  | { type: "scroll"; lines: number }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };
```

Server messages:

```ts
type ServerMessage =
  | { type: "output"; data: string }
  | { type: "status"; status: string }
  | { type: "error"; message: string };
```

Disconnect behavior:

```text
WebSocket disconnect = detach client only
WebSocket disconnect != kill terminal
```

---

## 14. Terminal Runtime Strategy

Session names should be deterministic.

Examples:

```text
tmux:    muxmap-default-atlas-api
tmux:    muxmap-default-DEV-1420
zellij:  muxmap-zellij-default-DEV-1499
```

tmux session creation:

```bash
tmux new-session -d -s muxmap-default-DEV-1420 -c ~/projects/atlas-api/services/auth
```

Zellij session creation:

```bash
zellij --config <muxmap-zellij-config> attach --create muxmap-zellij-default-DEV-1420
```

Attach behavior:

1. User selects a terminal-enabled node.
2. Backend checks session registry.
3. Backend checks whether the tmux/Zellij runtime exists.
4. If session exists, reattach.
5. If missing, recreate or show stopped state.
6. WebSocket streams IO between browser and runtime-backed PTY.

Recommended approach:

```text
xterm.js → WebSocket → node-pty → tmux attach-session / zellij attach
```

---

## 15. Auto Layout

Use deterministic left-to-right tree layout.

Rules:

* Root at depth 0
* Repos at depth 1
* Features at depth 2
* Tickets/notes at depth 3+
* Leaves are positioned first
* Parent y-position is the midpoint of child nodes
* New node creation triggers re-layout

Pseudo-code:

```ts
function layout(root: WorkNode) {
  let leafCursor = 0;

  function place(node: WorkNode, depth: number): number {
    const children = getChildren(node.id);

    node.x = depth * COLUMN_GAP;

    if (children.length === 0) {
      node.y = leafCursor * ROW_GAP;
      leafCursor++;
      return node.y;
    }

    const childYs = children.map(child => place(child, depth + 1));
    node.y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    return node.y;
  }

  place(root, 0);
}
```

Manual layout can be added later.

---

## 16. Persistence

Use SQLite for MVP.

Tables:

```text
workspaces
nodes
sessions
```

Optional later:

```text
layout_overrides
terminal_snapshots
jira_links
repo_configs
```

On backend startup:

1. Load saved sessions from DB.
2. Inspect live tmux/Zellij runtimes for the current platform.
3. Reconcile DB state with real terminal runtime state.
4. Mark missing sessions as `stopped`.
5. Keep existing live sessions attachable.

---

## 17. Security

For the local-first version:

* Default to `local` mode bound to `127.0.0.1`.
* Offer explicit authenticated `lan` and Tailscale-IP-only modes.
* Require a persistent token and Basic Auth outside localhost.
* Keep localhost Agent hooks strictly validated and authenticate non-local hooks.
* Check WebSocket origin.
* Restrict allowed repo paths.
* Do not expose arbitrary command execution over public network.
* Treat terminal access as privileged.

For future cloud version:

* User authentication
* Per-workspace permissions
* Audit logs
* Secrets handling
* Session ownership checks
* SSH key management

---

## 18. Implementation Plan

### Milestone 1: Static Prototype

* Compact mindmap
* Auto layout
* Hover detail
* Large terminal workspace window mock

### Milestone 2: Real Frontend

* React + TypeScript
* Node creation
* Node selection
* xterm.js terminal shell
* Graph state management

### Milestone 3: Local Backend

* Node.js server
* SQLite persistence
* Workspace/node/session APIs
* WebSocket gateway

### Milestone 4: Terminal Runtime Integration

* Create session
* Reattach session
* Stream terminal output
* Send terminal input
* Handle resize
* Keep session alive after browser close

### Milestone 5: Workflow Polish

* Search by Jira key
* Collapse/expand branches
* Fit selected project
* Keyboard shortcuts
* Better node creation UX

### Milestone 6: Product Hardening

* Archive and restore
* Settings UI and JSON editor
* Mobile bottom-sheet terminal
* Agent hooks and notifications
* Windows Zellij backend
* LAN/Tailscale doctor and network documentation
* Terminal link handling
* Duplicate runtime-name protection

---

## 19. Open Questions

1. Should ordinary non-`muxmap*` external tmux sessions be importable behind an explicit setting?
2. Should Jira tickets stay manually entered, or should sync be added as an optional integration?
3. Should repo paths be inherited from repo nodes by default with per-node overrides?
4. Should manual cross-branch layout be supported, or should the tree stay deterministic with only sibling reorder?
5. Should terminal scrollback snapshots be stored for stopped sessions?
6. Should remote devboxes use SSH labels only, or a first-class remote execution backend?

---

## 20. Final Product Definition

**MuxMap is a compact local-first mindmap workspace where developers organize work, attach persistent tmux/Zellij terminals to the nodes that need execution, and see local agent attention directly on the map.**
