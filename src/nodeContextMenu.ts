import type { WorkNode } from './model.ts'

const MENU_WIDTH = 200
const MENU_HEIGHT = 220
const VIEWPORT_MARGIN = 8
export type ContextMenuConfirmation = 'archive' | 'delete'

export function contextMenuPosition(x: number, y: number, viewportWidth: number, viewportHeight: number) {
  return {
    x: Math.max(VIEWPORT_MARGIN, Math.min(x, viewportWidth - MENU_WIDTH - VIEWPORT_MARGIN)),
    y: Math.max(VIEWPORT_MARGIN, Math.min(y, viewportHeight - MENU_HEIGHT - VIEWPORT_MARGIN)),
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
