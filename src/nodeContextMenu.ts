import type { WorkNode } from './model.ts'

export type ContextMenuConfirmation = 'archive' | 'delete'

export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8,
) {
  const maxX = Math.max(padding, viewportWidth - menuWidth - padding)
  const maxY = Math.max(padding, viewportHeight - menuHeight - padding)
  const preferredY = y + menuHeight > viewportHeight - padding ? y - menuHeight : y
  return {
    x: Math.max(padding, Math.min(x, maxX)),
    y: Math.max(padding, Math.min(preferredY, maxY)),
  }
}

export function duplicateNodeInput(node: WorkNode) {
  if (!node.parentId) return null
  return {
    parentId: node.parentId,
    title: `${node.title} copy`,
    type: node.type,
    project: node.project,
    color: node.color,
    repoPath: node.repoPath,
    jiraKey: node.jiraKey,
    note: node.note,
  }
}

export function contextMenuConfirmationText(action: ContextMenuConfirmation, hasLiveSession: boolean) {
  if (action === 'archive') return 'Confirm archive?'
  return hasLiveSession ? 'Confirm delete and stop session' : 'Confirm delete?'
}
