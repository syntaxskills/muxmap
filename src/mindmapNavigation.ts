import type { WorkNode } from './model.ts'

export type MindmapDirection = 'up' | 'down' | 'left' | 'right'
export type KeyboardOwner = 'mindmap' | 'terminal' | 'ui'

export type NavigationPoint = {
  x: number
  y: number
}

type NavigationTarget = {
  tagName?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

export function mindmapDirectionFromKey(key: string): MindmapDirection | undefined {
  if (key === 'ArrowUp') return 'up'
  if (key === 'ArrowDown') return 'down'
  if (key === 'ArrowLeft') return 'left'
  if (key === 'ArrowRight') return 'right'
}

export function blocksMindmapKeyboardNavigation(target: NavigationTarget | null | undefined) {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = target.tagName?.toUpperCase()
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true
  if (target.closest?.('.terminal, .xterm, .terminal-mount, .side-panel, .settings-panel, .terminal-splitter')) return true
  if ((tag === 'BUTTON' || tag === 'A') && !target.closest?.('.map-node')) return true
  return false
}

export function keyboardOwnerFromPointerTarget(target: NavigationTarget | null | undefined): KeyboardOwner | undefined {
  if (!target) return undefined
  if (target.closest?.('.terminal, .xterm, .terminal-mount')) return 'terminal'
  if (target.closest?.('.canvas, .map-node, .graph-stage')) return 'mindmap'
  return undefined
}

export function shouldMindmapHandleArrow(target: NavigationTarget | null | undefined, owner: KeyboardOwner | undefined) {
  if (owner === 'terminal') return false
  if (owner === 'mindmap') {
    if (!target) return true
    if (target.isContentEditable) return false
    const tag = target.tagName?.toUpperCase()
    const terminalFocusProxy = Boolean(target.closest?.('.terminal, .xterm, .terminal-mount'))
    return terminalFocusProxy || (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA')
  }
  return !blocksMindmapKeyboardNavigation(target)
}

export function navigateMindmapNode(nodes: WorkNode[], positions: Map<string, NavigationPoint>, selectedId: string | null, direction: MindmapDirection) {
  if (nodes.length === 0) return null
  const selected = selectedId ? nodes.find((node) => node.id === selectedId) : undefined
  if (!selected) return nodes[0]?.id ?? null
  const current = positions.get(selected.id)
  if (!current) return nodes[0]?.id ?? null

  const candidates = nodes
    .filter((node) => node.id !== selected.id && positions.has(node.id))
    .flatMap((node) => {
      const point = positions.get(node.id)!
      const dx = point.x - current.x
      const dy = point.y - current.y
      const primary = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx
      if (primary <= 0) return []
      const secondary = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy)
      const distance = Math.hypot(primary, secondary)
      return [{ id: node.id, distance, primary, secondary, order: node.sortOrder, createdAt: node.createdAt }]
    })
    .sort((a, b) => a.distance - b.distance || a.primary - b.primary || a.secondary - b.secondary || a.order - b.order || a.createdAt.localeCompare(b.createdAt))

  return candidates[0]?.id ?? selected.id
}
