import { NODE_WIDTH } from './nodeDimensions.ts'

export type TreeNode = {
  id: string
  parentId: string | null
  sortOrder: number
}

export type Point = { x: number; y: number }

export function centerPan(viewWidth: number, viewHeight: number, contentWidth: number, contentHeight: number, scale: number): Point {
  return { x: (viewWidth - contentWidth * scale) / 2, y: (viewHeight - contentHeight * scale) / 2 }
}

export function dragPan(origin: Point, start: Point, current: Point): Point {
  return { x: origin.x + current.x - start.x, y: origin.y + current.y - start.y }
}

export function zoomAtPoint(pan: Point, scale: number, nextScale: number, point: Point): Point {
  return {
    x: point.x - ((point.x - pan.x) / scale) * nextScale,
    y: point.y - ((point.y - pan.y) / scale) * nextScale,
  }
}

export function wheelPan(pan: Point, delta: Point): Point {
  return { x: pan.x - delta.x, y: pan.y - delta.y }
}

export function gridBackground(pan: Point, scale: number, gridSize = 20) {
  const size = gridSize * scale
  return { position: `${pan.x}px ${pan.y}px`, size: `${size}px ${size}px` }
}

export function isCanvasBlankTarget(targetClassName: string, currentTargetClassName: string) {
  return targetClassName === currentTargetClassName || ['stage-shell', 'graph-stage'].includes(targetClassName)
}

export function layoutTree(
  nodes: TreeNode[],
  rootId: string,
  columnGap = 240,
  rowGap = 30,
  nodeHeights = new Map<string, number>(),
  nodeWidths = new Map<string, number>(),
): Map<string, Point> {
  const positions = new Map<string, Point>()
  const children = new Map<string, TreeNode[]>()
  const defaultHeight = 42
  const defaultWidth = NODE_WIDTH
  const horizontalGap = Math.max(0, columnGap - defaultWidth)

  for (const node of nodes) {
    if (!node.parentId) continue
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }

  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const subtreeHeights = new Map<string, number>()

  function measure(nodeId: string): number {
    const descendants = children.get(nodeId) ?? []
    const childrenHeight = descendants.reduce((total, child) => total + measure(child.id), 0) + Math.max(0, descendants.length - 1) * rowGap
    const height = Math.max(nodeHeights.get(nodeId) ?? defaultHeight, childrenHeight)
    subtreeHeights.set(nodeId, height)
    return height
  }

  function place(nodeId: string, x: number, top: number) {
    const descendants = children.get(nodeId) ?? []
    const subtreeHeight = subtreeHeights.get(nodeId) ?? defaultHeight
    const nodeHeight = nodeHeights.get(nodeId) ?? defaultHeight
    const nodeWidth = nodeWidths.get(nodeId) ?? defaultWidth
    positions.set(nodeId, { x, y: top + (subtreeHeight - nodeHeight) / 2 })

    const childrenHeight = descendants.reduce((total, child) => total + (subtreeHeights.get(child.id) ?? defaultHeight), 0) + Math.max(0, descendants.length - 1) * rowGap
    let childTop = top + (subtreeHeight - childrenHeight) / 2
    const childX = x + Math.max(columnGap, nodeWidth + horizontalGap)
    for (const child of descendants) {
      place(child.id, childX, childTop)
      childTop += (subtreeHeights.get(child.id) ?? defaultHeight) + rowGap
    }
  }

  measure(rootId)
  place(rootId, 0, 0)
  return positions
}
