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

Workspace state is persisted in SQLite under the configured data directory. The database stores workspaces, nodes, sessions, archive state, last activity timestamps, and Agent activity.

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

## Network model

Default mode is local-only. Non-local access requires an explicit mode and either Basic Auth with `MUXMAP_TOKEN` or the deliberate `MUXMAP_AUTH=none` override.

Use `npm run doctor` to check the selected mode, bind address, usable URLs, authentication, Zellij, Tailscale, and Windows Firewall rules.
