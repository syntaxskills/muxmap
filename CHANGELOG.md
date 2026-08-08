# Changelog

All notable changes to MuxMap are documented here.

## [Unreleased]

### Changed

- Shortened the README around the core workflow, one product screenshot, and setup path.
- Added native Windows terminal support through Zellij 0.44.3+, including persistent reattachment, orphan management, agent hooks, and Windows CI coverage.
- Added explicit local, authenticated LAN, and Tailscale-only network access modes with accurate startup URLs.
- Added `npm run doctor` for port, authentication, Zellij, Tailscale, and least-privilege Windows Firewall checks.
- Added a VS Code-style settings editor with 20 live options, compact category UI, editable JSON, browser persistence, and platform-aware terminal backends.

### Fixed

- Made terminal gestures navigate tmux history without becoming arrow keys while preserving text selection and native copying.
- Hid tmux-specific delete choices when a node branch has no live session.
- Stopped injecting detach keystrokes into Windows terminals and enabled Zellij's font-safe UI.
- Kept authenticated Agent hooks working outside localhost while preserving the strict local hook path.

## [0.1.0] - 2026-08-07

### Added

- Compact, auto-laid-out mindmap with inline creation, rename, sibling reorder, search, collapse, color inheritance, and a node context menu.
- Persistent tmux terminals with docked, floating, full-screen, resize, opacity, scrollback, and macOS navigation support.
- SQLite workspace persistence, orphan tmux inventory and adoption, explicit stop/delete confirmations, and refresh-safe terminal restoration.
- Local Codex, Claude Code, Pi, and SSH detection with optional lifecycle hooks, activity states, elapsed time, and browser notifications.
- Localhost authentication, origin checks, allowed-root enforcement, API validation, an MIT license, and continuous integration.

### Fixed

- Kept the backend alive after PTY launch failures and made empty API responses readable.
- Prevented React StrictMode cleanup from stopping replacement terminal connections.
- Restored trackpad terminal scrollback, default tmux socket visibility, canvas pinch zoom, floating terminal bounds, and reliable node actions.

[Unreleased]: https://github.com/syntaxskills/muxmap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/syntaxskills/muxmap/releases/tag/v0.1.0
