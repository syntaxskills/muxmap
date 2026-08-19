# Changelog

All notable changes to MuxMap are documented here.

## [Unreleased]

### Changed

- Added arrow-key mindmap navigation that hops to the nearest visible node while leaving arrow keys untouched inside terminals and form controls.
- Reworked the README into a shorter open-source landing page and moved operational detail into focused architecture and Agent hook docs.
- Updated the PRD and acceptance coverage to reflect archive, settings, mobile, Agent activity, Windows/Zellij, terminal links, and duplicate runtime-name behavior.
- Added persistent last-activity timestamps for terminal input, terminal/Agent output, and Agent hooks, with compact minute/hour/day ages on every linked node.
- Made in-page Agent notifications fade and dismiss themselves after eight seconds.
- Added confirmed permanent deletion for archived nodes and branches, including explicit orphan-or-stop choices for live sessions.
- Let long mindmap titles wrap onto a second line before truncating.
- Made Agent state unmistakable: active work sweeps a green light across its node, Pi uses a compact black square-matrix loader, completion jumps the Agent icon, and input requests show a node-corner question mark.
- Added notification delivery controls for system-only, in-page-only, combined, or fully disabled alerts.
- Added a Settings action that sends a real browser-mediated system notification and reports permission or delivery errors in place.
- Added a clickable in-app alert fallback and hid node types by default.
- Added explicit password-free LAN/Tailscale access and a mobile layout with an 80% bottom Terminal sheet, focused nodes, safe-area support, and compact touch navigation.
- Added reversible node and branch archiving with preserved hierarchy, search, restore, and terminal sessions.
- Shortened the README around the core workflow, one product screenshot, and setup path.
- Added native Windows terminal support through Zellij 0.44.3+, including persistent reattachment, orphan management, agent hooks, and Windows CI coverage.
- Added explicit local, authenticated LAN, and Tailscale-only network access modes with accurate startup URLs.
- Added `npm run doctor` for port, authentication, Zellij, Tailscale, and least-privilege Windows Firewall checks.
- Added a VS Code-style settings editor with 20 live options, compact category UI, editable JSON, browser persistence, and platform-aware terminal backends.
- Added configurable inactive-node dimming for old terminal nodes, guarded by both a minimum inactive age and the oldest visible activity cohort.
- Added open-file-limit diagnostics for `posix_spawnp failed` terminal startup failures.
- Added selectable, one-click-copy session binding rows for Agent and terminal identifiers.
- Changed settings JSON export to a nested structure while preserving legacy dotted-key import and persisted-setting migration.
- Rewrote the README introduction around the core terminal-context pain point and added a dedicated screenshots guide.

### Fixed

- Claude Code permission approval now clears the `needs_input` node state on the next lightweight `PreToolUse` hook without installing the heavier `PostToolUse` hook.
- Stopped terminal link detection from swallowing adjacent page text such as `Home` after local development URLs.
- Kept archived nodes discoverable inside their original parent and preserved nested archive behavior when the parent is archived too.
- Made the full expanded node surface open its linked Terminal, including metadata in the lower half.
- Removed the duplicate node-level Terminal button because selecting a terminal-enabled node already opens it.
- Made terminal gestures navigate tmux history without becoming arrow keys while preserving text selection and native copying.
- Hid tmux-specific delete choices when a node branch has no live session.
- Stopped injecting detach keystrokes into Windows terminals and enabled Zellij's font-safe UI.
- Kept authenticated Agent hooks working outside localhost while preserving the strict local hook path.
- Stopped live terminal sessions automatically when archiving their node or branch.

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
