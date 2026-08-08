# MuxMap

[![CI](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml/badge.svg)](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml)

MuxMap is a local-first mindmap for organizing development work and persistent terminals.

- Create, rename, duplicate, color, collapse, and reorder nodes.
- Dock, float, resize, or full-screen terminal sessions.
- Reattach after refresh and manage orphan `muxmap*` sessions.
- Detect Codex, Claude Code, Pi, and SSH activity.
- Persist workspaces in SQLite and bind the server to localhost.

![MuxMap workspace](docs/assets/muxmap-workspace.png)

## Quick start

Requires Node.js 22+ and native build tools for `node-pty`. Install tmux on macOS/Linux or [Zellij 0.44.3+](https://github.com/zellij-org/zellij/releases) on Windows.

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. For production, run `npm run build && npm start` and open <http://127.0.0.1:4782>.

Optional Agent lifecycle hooks:

```bash
npm run hooks:install
```

## Verify

```bash
npm test
npm run lint
npm run build
```

MuxMap is privileged local software. Keep it on localhost and restrict terminal paths with `MUXMAP_ALLOWED_ROOTS`.

For trusted LAN access, set `HOST=0.0.0.0` and a persistent `MUXMAP_TOKEN`, then allow TCP 4782 through the host firewall. Sign in as `muxmap` with that token; non-local binding is refused without it.

[PRD](docs/PRD.md) · [Acceptance](docs/ACCEPTANCE.md) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE)
