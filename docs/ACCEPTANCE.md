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
- [x] Default node type stays hidden unless enabled in settings
- [x] Unbounded drag-to-pan canvas and center control
- [x] Zoom in, zoom out, fit all, and fit project
- [x] Deterministic auto-layout after creation
- [x] Hover expansion and layout reflow use reduced-motion-aware transitions
- [x] Expanded node click target opens its linked terminal from the full node surface
- [x] Blank-canvas click collapses the currently pinned node
- [x] Dragging reorders siblings without allowing arbitrary free placement
- [x] Search by title, project, or Jira key
- [x] Collapse and expand branches
- [x] Keyboard shortcuts for search, creation, zoom, and fit
- [x] Layout check with 48 leaf nodes

## Nodes and persistence

- [x] Workspace, repository, feature, ticket, note, todo, and terminal task types
- [x] SQLite workspace, nodes, and sessions tables
- [x] Node creation with inherited or explicit project, color, and repository path
- [x] Child nodes inherit color unless the user overrides it
- [x] Archived nodes remain under their original parent context
- [x] Archiving a node or branch stops its live terminal sessions
- [x] Archived branches can be restored or permanently deleted with confirmation
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
- [x] Trackpad scrolling in terminal scrollback never becomes up/down key input
- [x] Closing and reopening the terminal window preserves the terminal runtime
- [x] WebSocket input, output, resize, and status protocol
- [x] node-pty bridge to tmux/Zellij
- [x] Real tmux + node-pty integration smoke test when tmux is installed
- [x] Windows defaults to Zellij 0.44.3+ and CI verifies create, attach, detach, reattach, and stop through node-pty
- [x] Deterministic session names and reuse
- [x] Duplicate node titles cannot accidentally share the same terminal runtime name
- [x] Refresh and reconnect to existing sessions
- [x] Browser disconnect detaches the PTY client without killing the runtime
- [x] Explicit stop action kills the runtime
- [x] Startup reconciliation marks missing sessions stopped
- [x] React StrictMode cleanup cannot mark a replacement connection stopped
- [x] Runtime inventory discovers every live `muxmap*` tmux/Zellij session
- [x] Orphan sessions can attach to a selected node, create a root terminal node, or stop
- [x] Node deletion explicitly keeps the runtime as an orphan or stops it with the node
- [x] Codex, Claude Code, Pi, and SSH are detected from local terminal process trees
- [x] Local Agent hooks expose working, needs-input, completed/read, and elapsed-time state
- [x] Agent hooks outside MuxMap are safe: plain terminals no-op and non-`muxmap*` sessions are ignored
- [x] Agent activity persists across browser refresh and includes orphan sessions
- [x] SSH is labeled without remote installation or inspection
- [x] Human-created agent channels connect two terminal-backed nodes and render on the map
- [x] Agent channels persist with MCP-ready URIs and message API storage
- [x] Terminal links open browser URLs and local dev URLs in a new tab
- [x] Terminal command box sends dictated/edited input to the active session
- [x] Terminal command-box history persists per session without writing shell history
- [x] Terminal scrollback, trackpad history navigation, and text selection/copy regressions are covered

## App shell

- [x] SVG favicon is served by development and production builds
- [x] README links to architecture, hook, network, acceptance, changelog, and license docs

## Network security

- [x] Local mode binds to localhost by default
- [x] LAN mode binds all interfaces only with a persistent token
- [x] Tailscale mode detects and binds only its Tailscale IPv4 address
- [x] Non-local browsers use Basic Auth and Agent hooks remain authenticated
- [x] Network doctor diagnoses startup requirements and generates narrow Windows Firewall repair scripts
- [x] HttpOnly local authentication token
- [x] Origin checks for mutations and WebSockets
- [x] Allowed repository-root enforcement
- [x] Request size, node input, terminal input, and resize validation

## Explicitly excluded by the PRD

Jira sync, GitHub/GitLab integration, multiplayer, AI automation, manual layout persistence, cloud sandboxes, full tmux pane/window management, remote shells, and team permissions remain non-MVP.
