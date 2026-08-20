# MuxMap

[![CI](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml/badge.svg)](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml)

A mindmap that remembers what every terminal is for.

MuxMap is a local-first mindmap for managing developer context: repos, tickets, notes, agent runs, and persistent terminals.

Most terminal-heavy workflows eventually become a pile of anonymous panes. MuxMap gives each session a place in the work graph, so you can see what you are working on, jump back into the right terminal, and keep long-running tmux or Zellij sessions alive across browser refreshes.

![MuxMap mindmap with docked terminal](docs/assets/muxmap-docked-terminal.png)

## What it does

- Organize repos, features, tickets, notes, and terminal tasks in a compact tree.
- Attach a persistent terminal to any node, then dock, float, resize, or full-screen it.
- Reopen the browser and reattach to the same session.
- Archive completed nodes to keep them searchable while stopping their live terminal sessions.
- Manage orphan `muxmap*` sessions instead of leaving hidden tmux/Zellij clutter.
- Track Codex, Claude Code, Pi, and SSH activity with optional system or in-page notifications.
- Manually connect two terminal-backed nodes into an agent chat channel and see that relationship on the map.
- Use the terminal command box for voice-friendly input with MuxMap-managed history.
- Tune the workspace through a VS Code-style settings UI or JSON editor.

## Quick start

Requirements:

- Node.js 22+
- Native build tools for `node-pty`
- tmux on macOS/Linux, or Zellij 0.44.3+ on Windows

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173>.

If opening a terminal shows `posix_spawnp failed` on macOS/Linux, check the file descriptor limit:

```bash
ulimit -n
```

`256` is too low for terminal-heavy use. Restart MuxMap from the same shell after:

```bash
ulimit -n 4096
```

For the production server:

```bash
npm run build
npm start
```

Open <http://127.0.0.1:4782>.

## Agent hooks

Agent hooks are optional. They let MuxMap mark agent sessions as working, completed, read, unavailable, or needing input.

```bash
npm run hooks:install
npm run hooks:status
npm run hooks:update
```

Hooks are safe outside MuxMap sessions: plain terminals no-op, ordinary tmux sessions are ignored, and live `muxmap*` sessions can appear as orphans for adoption.
Run `npm run hooks:update` after pulling hook changes so existing Codex/Claude/Pi installs get the latest event coverage and resume metadata.

## Access modes

MuxMap starts in local mode and binds only `127.0.0.1`. Use `npm run doctor` before exposing it to another device.

| Mode | Use case | Auth |
| --- | --- | --- |
| `local` | Same machine only | Local session cookie |
| `lan` | Trusted local network | `MUXMAP_TOKEN` Basic Auth |
| `tailscale` | Tailnet access | `MUXMAP_TOKEN` Basic Auth |

Password-free LAN/Tailscale mode is explicit via `MUXMAP_AUTH=none`. That exposes terminal control to clients allowed by your network and firewall.

## Settings

Open Settings from the top bar. Every setting is editable through the UI or the nested JSON tab. Legacy dotted JSON keys are still accepted. Inactive terminal nodes are dimmed by default only when both are true:

- last activity is at least `mindmap.inactiveAfterHours` old, default `36`
- the node belongs to the oldest `mindmap.inactiveOldestPercent` of visible terminal nodes, default `50`

## Verify

```bash
npm test
npm run lint
npm run build
npm run doctor
```

## Docs

- [Product and technical design](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Agent hooks](docs/AGENT-HOOKS.md)
- [Screenshots](docs/SCREENSHOTS.md)
- [Windows LAN/Tailscale setup](docs/WINDOWS-NETWORK.md)
- [Acceptance coverage](docs/ACCEPTANCE.md)
- [Changelog](CHANGELOG.md)
- [MIT License](LICENSE)
