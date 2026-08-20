function stringField(input: unknown, keys: string[]) {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
}

export default function muxMapStatus(pi: { on(event: string, listener: (event?: unknown) => void): void }) {
  const report = (type: string, details?: unknown) => {
    const tmuxPane = process.env.TMUX_PANE
    const zellijSession = process.env.ZELLIJ_SESSION_NAME
    const locator = tmuxPane
      ? { backend: 'tmux', paneId: tmuxPane }
      : zellijSession ? { backend: 'zellij', runtimeName: zellijSession, paneId: process.env.ZELLIJ_PANE_ID } : undefined
    if (!locator) return
    const session = details && typeof details === 'object' && 'session' in details ? (details as Record<string, unknown>).session : undefined
    const sessionId = stringField(details, ['session_id', 'sessionId', 'id']) ?? stringField(session, ['session_id', 'sessionId', 'id'])
    const sessionPath = stringField(details, ['session_path', 'sessionPath', 'path']) ?? stringField(session, ['session_path', 'sessionPath', 'path'])
    const cwd = stringField(details, ['cwd']) ?? process.cwd()
    void fetch(`${process.env.MUXMAP_URL ?? 'http://127.0.0.1:4782'}/api/agent-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-muxmap-hook': '1' },
      body: JSON.stringify({ kind: 'pi', locator, event: { type, ...(sessionId ? { session_id: sessionId } : {}), ...(sessionPath ? { session_path: sessionPath } : {}), cwd } }),
    }).catch(() => {})
  }
  pi.on('agent_start', (event) => report('agent_start', event))
  pi.on('agent_end', (event) => report('agent_end', event))
}
