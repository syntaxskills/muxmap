# MuxMap

[![CI](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml/badge.svg)](https://github.com/syntaxskills/muxmap/actions/workflows/ci.yml)

MuxMap is a local-first mindmap for organizing development work and persistent terminals.

- Create, rename, duplicate, color, collapse, reorder, and archive nodes.
- Dock, float, resize, or full-screen terminal sessions.
- Reattach after refresh and manage orphan `muxmap*` sessions.
- Detect Codex, Claude Code, Pi, and SSH activity.
- Tune 20 workspace options through compact UI or `settings.json`.
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
npm run doctor
```

MuxMap is privileged software. Restrict terminal paths with `MUXMAP_ALLOWED_ROOTS` and choose an explicit access mode:

| `MUXMAP_ACCESS` | Bind address | Authentication |
| --- | --- | --- |
| `local` (default) | `127.0.0.1` | Local session cookie |
| `lan` | `0.0.0.0` | `MUXMAP_TOKEN` required |
| `tailscale` | Detected by `tailscale ip -4` | `MUXMAP_TOKEN` required |

LAN/Tailscale browsers use Basic Auth with username `muxmap` and password `MUXMAP_TOKEN`. Hooks send the same credential when the token is in their environment; for direct Tailscale binding, also set `MUXMAP_URL` to the logged Tailscale URL. `HOST=0.0.0.0` remains a compatibility alias for LAN mode.

To deliberately remove the password, set `MUXMAP_AUTH=none` with `MUXMAP_ACCESS=lan` or `tailscale`. This exposes terminal control to every client allowed by the network and firewall, so password authentication remains the default.

Run `npm run doctor` before exposing MuxMap. It checks the selected address and URLs, port availability, authentication, Zellij and Tailscale, and Windows Firewall. When a Windows network rule is missing, it writes an administrator PowerShell script under `MUXMAP_DATA_DIR` (or `.muxmap`) restricted to the current LAN subnet; Tailscale rules allow only `100.64.0.0/10`.

On Windows, allow only Tailscale IPv4 clients from an Administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "MuxMap Tailscale" -Direction Inbound -Protocol TCP -LocalPort 4782 -RemoteAddress 100.64.0.0/10 -Action Allow
```

Alternatively, keep local mode and run `tailscale serve --bg 4782` for tailnet-only HTTPS.

[Windows LAN/Tailscale setup](docs/WINDOWS-NETWORK.md)

[PRD](docs/PRD.md) · [Acceptance](docs/ACCEPTANCE.md) · [Changelog](CHANGELOG.md) · [MIT License](LICENSE)
