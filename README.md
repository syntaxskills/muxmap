# MuxMap

[![CI](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml/badge.svg)](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml)

MuxMap is a local-first mindmap workspace for repositories, features, Jira tickets, notes, and persistent tmux-backed terminal sessions.

## Screenshots

The mindmap keeps repository and work context compact. Drag the unbounded canvas, center it when needed, use `+` to create a child inline, and double-click any node to rename it. Right-click a node to add, rename, duplicate, collapse, or request deletion. Node type and metadata stay editable in the detail panel.

![MuxMap workspace showing a compact, general-purpose development mindmap](docs/assets/muxmap-workspace.png)

Terminal-enabled nodes show a compact preview in the detail panel. Expanding it docks the terminal on the right at roughly 50/50 with a draggable divider, so the mindmap remains visible. The terminal can float as a draggable, resizable window or go full screen. Global settings persist terminal opacity and the split ratio per browser. Closing the terminal detaches the browser while tmux keeps running; trackpad scrolling is never translated into arrow-key input.

![MuxMap terminal in its optional floating workspace mode](docs/assets/muxmap-terminal.png)

The session count opens a runtime inventory for every live `muxmap*` tmux session. MuxMap always uses the normal default tmux server, so sessions also appear in plain `tmux ls`. Unlinked sessions can be attached to the selected node, placed in a new root node, or stopped. Deleting a node explicitly offers either keeping its tmux session as an orphan or stopping it with the node.

![MuxMap runtime inventory with a detected coding agent](docs/assets/muxmap-sessions.png)

MuxMap automatically detects Codex, Claude Code, Pi, and SSH from each local tmux pane's process tree. Install the optional local lifecycle hooks to add `Working`, `Needs input`, `Completed`, read acknowledgements, and elapsed-time updates; detected agents without Hook events show `Status unavailable`:

```bash
npm run hooks:install
```

Codex asks you to review the new command hooks once in `/hooks`. Start a new agent session after installing because running agents do not reload hooks. Claude Code loads its user settings directly; Pi uses a local extension. SSH is labeled only. MuxMap does not install or inspect anything remotely.

Enable browser notifications in Settings to receive one Chrome alert when a linked agent completes or needs input. Clicking the alert focuses MuxMap and opens the linked terminal. These alerts require the MuxMap page to remain open; existing OS-level Agent hooks can still cover closed-page notifications.

Agent marks identify their respective tools and belong to OpenAI, Anthropic, and the Pi project.

## Requirements

- Node.js 22+
- tmux
- Linux or macOS with build tools for `node-pty`

## Run

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The development command starts both the backend and Vite.

For the production build:

```bash
npm run build
npm start
```

Open <http://127.0.0.1:4782>.

## Verify

```bash
npm test
npm run lint
npm run build
```

The test suite covers SQLite persistence, API security and validation, deterministic layout, graph filtering, tmux lifecycle and orphan adoption, local Agent detection, deduplicated browser notifications, WebSocket input/resize, StrictMode cleanup, and browser disconnect behavior.

## Local security

MuxMap binds to `127.0.0.1`, issues an HttpOnly local token, validates mutating-request and WebSocket origins, and restricts terminal working directories. By default, repositories under the parent of this repository are allowed.

Configuration:

```bash
PORT=4782
MUXMAP_DATA_DIR=.muxmap
MUXMAP_ALLOWED_ROOTS=/path/to/repos,/another/path
MUXMAP_ALLOWED_ORIGINS=http://127.0.0.1:5173
MUXMAP_TOKEN=optional-fixed-token
```

Product requirements: [`docs/PRD.md`](docs/PRD.md). Acceptance coverage: [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md). Release history: [`CHANGELOG.md`](CHANGELOG.md).

## License

[MIT](LICENSE)
