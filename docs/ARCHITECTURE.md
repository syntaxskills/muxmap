# Architecture

MuxMap is a local-first web app with a privileged backend. The browser is a client; the backend owns workspace data and terminal lifecycle.

```text
Browser
├── React mindmap
├── right-side workbench panels
├── docked/floating/full-screen xterm.js terminal
└── optional browser notifications

Node server
├── workspace and node API
├── SQLite persistence
├── session registry
├── orphan session inventory
├── Agent hook endpoint
└── WebSocket terminal gateway

Execution layer
├── tmux on macOS/Linux
├── Zellij 0.44.3+ on Windows
└── node-pty bridge
```

## Storage

Workspace state is persisted in SQLite under the configured data directory. The database stores workspaces, nodes, sessions, archive state, last activity timestamps, Agent activity, human-created agent channels, channel messages, and terminal command-box history.

The terminal process itself is not stored in SQLite. tmux or Zellij owns the live shell. On startup MuxMap reconciles the database with live sessions and marks missing sessions stopped.

## Session naming

MuxMap-managed runtime names start with `muxmap`.

- macOS/Linux tmux: `muxmap-default-run-tests`
- Windows Zellij: `muxmap-zellij-default-run-tests`

Names are deterministic where possible. If two nodes would produce the same runtime name, MuxMap keeps the first name and adds a stable suffix for the later node instead of accidentally sharing one terminal.

## Orphans

Live `muxmap*` sessions that are not linked to a node are shown as orphans. They can be:

- attached to the selected node;
- converted into a root terminal node;
- stopped explicitly.

Deleting or archiving nodes does not silently kill terminal sessions. Stop choices are explicit.

## Agent channels

Agent channels are manual relationships between two terminal-backed nodes. They are intentionally inactive until a human connects two nodes from the map context menu. A channel stores a stable `muxmap://agent-channels/<id>` URI, per-node route metadata, and optional message history so an MCP adapter or local tool can route collaboration through that specific relationship later.

MuxMap's default transport remains `muxmap-local`, so channels work even when vendor-specific messaging is unavailable. Claude Code cross-session sockets are treated as readiness metadata when hooks expose `CLAUDE_CODE_MESSAGING_SOCKET`; MuxMap does not persist `CLAUDE_CODE_MESSAGING_TOKEN`. A2A is treated as an interoperable design reference for future peer endpoints, not a hard dependency.

Channel messaging is intentionally bounded. The MCP contract should send concise text, write long artifacts to files, and pass file paths or summaries through the channel. The default sliding-window quota is 50 messages per hour, warning at 250k estimated tokens per hour, and hard-closing the channel before it exceeds 500k estimated tokens per hour. The quota is per hour, not lifetime, so multi-day collaboration can continue after the window rolls over.

The map renders channels as lightweight dashed edges. Channels are separate from the tree hierarchy; deleting a node deletes its channels through SQLite foreign keys.

Channel API:

- `POST /api/workspaces/:workspaceId/agent-channels`
- `GET /api/agent-channels/:channelId/messages`
- `POST /api/agent-channels/:channelId/messages`
- `GET /api/agent-channels/:channelId/usage`
- `DELETE /api/agent-channels/:channelId`

## Terminal command box

The browser terminal still owns normal keyboard input. The command box below it is a separate input path optimized for dictated or edited text. Submissions are sent to the active WebSocket as terminal input and also stored in MuxMap's `terminal_input_history` table per session.

MuxMap does not write these entries into zsh or shell history. That avoids polluting shell state with prose or multi-line dictated text while keeping the history available across refreshes.

History API:

- `GET /api/sessions/:sessionId/input-history`
- `POST /api/sessions/:sessionId/input-history`

## Network model

Default mode is local-only. Non-local access requires an explicit mode and either Basic Auth with `MUXMAP_TOKEN` or the deliberate `MUXMAP_AUTH=none` override.

Use `npm run doctor` to check the selected mode, bind address, usable URLs, authentication, Zellij, Tailscale, and Windows Firewall rules.
