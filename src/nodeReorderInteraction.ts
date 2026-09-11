import { canReparentNode, type ReorderPosition } from './graph.ts'
import type { WorkNode } from './model.ts'

type Point = { x: number; y: number }
type Bounds = { top: number; height: number }
export type NodeDropTarget = { id: string; position: ReorderPosition | 'inside' }

export function dragIntent(start: Point, current: Point, threshold = 6) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

export function dropPositionAt(clientY: number, bounds: Bounds): ReorderPosition {
  return clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

export function nodeDropTarget(nodes: WorkNode[], movedId: string, targetId: string, clientY: number, bounds: Bounds): NodeDropTarget | null {
  const moved = nodes.find((node) => node.id === movedId)
  const target = nodes.find((node) => node.id === targetId)
  if (!moved?.parentId || !target || movedId === targetId) return null
  const fraction = (clientY - bounds.top) / bounds.height
  if (moved.parentId === target.parentId && (fraction < 0.25 || fraction > 0.75)) {
    return { id: targetId, position: dropPositionAt(clientY, bounds) }
  }
  return canReparentNode(nodes, movedId, targetId) ? { id: targetId, position: 'inside' } : null
}

export function pointerReleaseIntent(dragging: boolean, hasDropTarget: boolean): 'activate' | 'reorder' | 'none' {
  if (!dragging) return 'activate'
  return hasDropTarget ? 'reorder' : 'none'
}
