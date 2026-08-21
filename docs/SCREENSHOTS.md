# Screenshots

These screenshots show the main MuxMap flows: organizing work in the map, opening the right terminal quickly, managing sessions, and using the mobile layout.

They are captured from the built-in synthetic demo graph, with 13 visible nodes and 7 agent/session states. No real workspace, account, repo, ticket, or terminal history is shown.

## Main workflow: map on the left, Codex on the right

The primary workflow is a split workspace. The mindmap keeps project context visible while the selected node owns a persistent terminal running Codex on the right.

![MuxMap mindmap with docked terminal](assets/muxmap-docked-terminal.png)

## Workspace map and node actions

Nodes can represent repos, features, tickets, notes, todos, or terminal tasks. The map stays compact; node details and common actions appear only when needed.

![MuxMap workspace map](assets/muxmap-workspace.png)

## Floating terminal

Terminals can also float above the map when you need more flexible placement, then dock or full-screen again.

![MuxMap floating terminal](assets/muxmap-terminal.png)

## Sessions and orphans

MuxMap inventories live `muxmap*` tmux or Zellij sessions, including orphaned sessions that no longer belong to a visible node. You can adopt or stop them explicitly.

![MuxMap sessions](assets/muxmap-sessions.png)

## Mobile map

On small screens, the map remains the entry point for choosing the node and context.

![MuxMap mobile map](assets/muxmap-mobile-map.png)

## Mobile terminal

The terminal opens as a bottom sheet so the selected work stays connected to the map.

![MuxMap mobile terminal](assets/muxmap-mobile-terminal.png)

## Mobile details

Node details, metadata, and terminal controls stay available without crowding the map.

![MuxMap mobile details](assets/muxmap-mobile-details.png)
