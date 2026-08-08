# MVP Acceptance Coverage

## Mindmap canvas

- [x] Compact left-to-right hierarchy
- [x] Project color markers
- [x] Terminal status badges
- [x] Full metadata on hover
- [x] Click selection and detail panel
- [x] Contextual node `+` control creates and renames a child inline
- [x] Node context menu supports adding, renaming, duplicating, collapsing, and confirmed deletion
- [x] Double-click inline rename and editable node detail fields
- [x] User-selected node type independent of tree depth
- [x] Unbounded drag-to-pan canvas and center control
- [x] Zoom in, zoom out, fit all, and fit project
- [x] Deterministic auto-layout after creation
- [x] Hover expansion and layout reflow use reduced-motion-aware transitions
- [x] Search by title, project, or Jira key
- [x] Collapse and expand branches
- [x] Keyboard shortcuts for search, creation, zoom, and fit
- [x] Layout check with 48 leaf nodes

## Nodes and persistence

- [x] Workspace, repository, feature, ticket, note, todo, and terminal task types
- [x] SQLite workspace, nodes, and sessions tables
- [x] Node creation with inherited or explicit project, color, and repository path
- [x] Reload from persisted graph
- [x] Loading, empty, and error states

## Terminal

- [x] xterm.js browser terminal
- [x] Large, resizable terminal workspace window
- [x] Terminal opens docked on the right in a persistent, draggable split view
- [x] Draggable terminal window with full-screen and restore controls
- [x] Float and dock controls switch between split and overlay modes
- [x] Compact detail-panel terminal preview expands into the workspace window
- [x] Terminal header and graph highlight show the linked node
- [x] Global terminal opacity setting persists in the browser
- [x] Trackpad scrolling in tmux never becomes up/down key input
- [x] Closing and reopening the terminal window preserves the tmux session
- [x] WebSocket input, output, resize, and status protocol
- [x] node-pty bridge to tmux
- [x] Real tmux + node-pty integration smoke test when tmux is installed
- [x] Windows defaults to Zellij 0.44.3+ and CI verifies create, attach, detach, reattach, and stop through node-pty
- [x] Deterministic session names and reuse
- [x] Refresh and reconnect to existing sessions
- [x] Browser disconnect detaches the PTY client without killing tmux
- [x] Explicit stop action kills tmux
- [x] Startup reconciliation marks missing sessions stopped
- [x] React StrictMode cleanup cannot mark a replacement connection stopped
- [x] Runtime inventory discovers every live `muxmap*` tmux session
- [x] Orphan sessions can attach to a selected node, create a root terminal node, or stop
- [x] Node deletion explicitly keeps tmux as an orphan or stops it with the node
- [x] Codex, Claude Code, Pi, and SSH are detected from local tmux process trees
- [x] Local Agent hooks expose working, needs-input, completed/read, and elapsed-time state
- [x] Agent activity persists across browser refresh and includes orphan sessions
- [x] SSH is labeled without remote installation or inspection

## App shell

- [x] SVG favicon is served by development and production builds

## Local security

- [x] Server binds to localhost
- [x] HttpOnly local authentication token
- [x] Origin checks for mutations and WebSockets
- [x] Allowed repository-root enforcement
- [x] Request size, node input, terminal input, and resize validation

## Explicitly excluded by the PRD

Jira sync, GitHub/GitLab integration, multiplayer, AI automation, manual layout persistence, cloud sandboxes, full tmux pane/window management, remote shells, and team permissions remain non-MVP.
