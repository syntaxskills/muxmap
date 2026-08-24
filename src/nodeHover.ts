export const NODE_HOVER_LEAVE_GRACE_MS = 150

export function clearHoveredNodeAfterGrace(currentHoveredId: string | null, leavingNodeId: string) {
  return currentHoveredId === leavingNodeId ? null : currentHoveredId
}

export function nodeUsesExpandedLayout(nodeId: string, selectedId: string | null) {
  return nodeId === selectedId
}

export function nodeUsesExpandedRender(nodeId: string, selectedId: string | null, hoveredId: string | null) {
  return nodeId === selectedId || nodeId === hoveredId
}
