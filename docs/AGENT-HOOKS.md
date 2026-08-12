# Agent hooks

MuxMap can receive lifecycle events from local coding agents and display their state on the node or orphan session that owns the terminal.

Supported status categories:

- `working`: an agent received input or started work;
- `needs_input`: the agent is asking for user action;
- `completed`: the agent finished and has not been read yet;
- `read`: the completed state was opened in MuxMap;
- `unavailable`: MuxMap can see an agent process but has not received hook status.

## Install and update

```bash
npm run hooks:install
npm run hooks:status
npm run hooks:update
```

`hooks:update` is idempotent. It refreshes stale MuxMap hook paths without replacing unrelated user hooks.

## How routing works

The hook sends the current terminal locator to MuxMap:

- tmux: `TMUX_PANE`;
- Zellij: `ZELLIJ_SESSION_NAME` and optional `ZELLIJ_PANE_ID`;
- Codex: direct `session_id` when supplied by the event;
- Claude Code: lifecycle and notification event fields when supplied.

MuxMap resolves the locator to a live runtime name. Only runtime names starting with `muxmap` are accepted for management.

## Outside MuxMap

The hook is intentionally harmless outside MuxMap:

- plain terminal: no locator, no request;
- ordinary tmux/Zellij session: request is ignored by the server;
- live `muxmap*` orphan: activity is tracked and can be adopted later;
- linked `muxmap*` session: activity appears on its node.

This avoids importing or stopping unrelated terminals by accident.

## Reliability rules

Hooks must not slow down the agent process.

- High-frequency events do not scan session files.
- If an event already includes a session id, that id is used directly.
- Codex session-file fallback is only allowed on `SessionStart` when the event lacks a direct id.
- Filesystem, JSON, network, timeout, and server errors are caught.
- The observer hook exits `0` even when MuxMap is not running.

Do not increase the hook timeout to hide slow behavior. Fix the hook path instead.
