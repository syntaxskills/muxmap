export type ViewState = {
  selectedId: string | null
  terminalSessionId: string | null
  terminalFloating: boolean
}

export function readViewState(search: string): ViewState {
  const params = new URLSearchParams(search)
  const terminalSessionId = params.get('terminal')
  return {
    selectedId: params.get('node'),
    terminalSessionId,
    terminalFloating: Boolean(terminalSessionId && params.get('view') === 'float'),
  }
}

export function writeViewState(search: string, state: ViewState) {
  const params = new URLSearchParams(search)
  if (state.selectedId) params.set('node', state.selectedId)
  else params.delete('node')
  if (state.terminalSessionId) params.set('terminal', state.terminalSessionId)
  else params.delete('terminal')
  if (state.terminalSessionId && state.terminalFloating) params.set('view', 'float')
  else params.delete('view')
  const next = params.toString()
  return next ? `?${next}` : ''
}
