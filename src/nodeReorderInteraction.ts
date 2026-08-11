import type { ReorderPosition } from './graph.ts'

type Point = { x: number; y: number }
type Bounds = { top: number; height: number }

export function dragIntent(start: Point, current: Point, threshold = 6) {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold
}

export function dropPositionAt(clientY: number, bounds: Bounds): ReorderPosition {
  return clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

export function pointerReleaseIntent(dragging: boolean, hasDropTarget: boolean): 'activate' | 'reorder' | 'none' {
  if (!dragging) return 'activate'
  return hasDropTarget ? 'reorder' : 'none'
}
