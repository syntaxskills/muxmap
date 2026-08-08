export type RightPanel = 'details' | 'archive' | 'sessions' | 'settings' | null

export type WorkspaceSurface = {
  rightPanel: RightPanel
  terminalSessionId: string | null
  terminalFloating: boolean
}

export function selectNodeSurface(terminalSessionId: string | null): WorkspaceSurface {
  return { rightPanel: terminalSessionId ? null : 'details', terminalSessionId, terminalFloating: false }
}

export function openTerminal(_surface: WorkspaceSurface, terminalSessionId: string): WorkspaceSurface {
  return { rightPanel: null, terminalSessionId, terminalFloating: false }
}

export function openRightPanel(surface: WorkspaceSurface, rightPanel: Exclude<RightPanel, null>): WorkspaceSurface {
  return {
    rightPanel: surface.rightPanel === rightPanel ? null : rightPanel,
    terminalSessionId: surface.terminalFloating ? surface.terminalSessionId : null,
    terminalFloating: surface.terminalFloating,
  }
}

export function floatTerminal(surface: WorkspaceSurface): WorkspaceSurface {
  const terminalFloating = !surface.terminalFloating
  return { ...surface, rightPanel: terminalFloating ? 'details' : null, terminalFloating }
}

export function closeTerminal(surface: WorkspaceSurface): WorkspaceSurface {
  return {
    rightPanel: surface.terminalFloating ? surface.rightPanel ?? 'details' : 'details',
    terminalSessionId: null,
    terminalFloating: false,
  }
}
