export const NODE_HOVER_LEAVE_GRACE_MS = 150
export const NODE_HOVER_HYSTERESIS_MARGIN = 40

export type RectLike = {
  left: number
  top: number
  right: number
  bottom: number
}

export type PointLike = {
  x: number
  y: number
}

export function clearHoveredNodeAfterGrace(currentHoveredId: string | null, leavingNodeId: string) {
  return currentHoveredId === leavingNodeId ? null : currentHoveredId
}

export function inflateRect(rect: RectLike, margin = NODE_HOVER_HYSTERESIS_MARGIN): RectLike {
  return {
    left: rect.left - margin,
    top: rect.top - margin,
    right: rect.right + margin,
    bottom: rect.bottom + margin,
  }
}

export function containsPoint(rect: RectLike, point: PointLike) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

export function nodeUsesExpandedLayout(nodeId: string, selectedId: string | null, hoveredId: string | null) {
  return nodeId === selectedId || nodeId === hoveredId
}
