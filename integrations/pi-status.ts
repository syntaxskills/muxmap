export default function muxMapStatus(pi: { on(event: string, listener: () => void): void }) {
  const report = (type: string) => {
    const tmuxPane = process.env.TMUX_PANE
    const zellijSession = process.env.ZELLIJ_SESSION_NAME
    const locator = tmuxPane
      ? { backend: 'tmux', paneId: tmuxPane }
      : zellijSession ? { backend: 'zellij', runtimeName: zellijSession, paneId: process.env.ZELLIJ_PANE_ID } : undefined
    if (!locator) return
    void fetch(`${process.env.MUXMAP_URL ?? 'http://127.0.0.1:4782'}/api/agent-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-muxmap-hook': '1' },
      body: JSON.stringify({ kind: 'pi', locator, event: { type } }),
    }).catch(() => {})
  }
  pi.on('agent_start', () => report('agent_start'))
  pi.on('agent_end', () => report('agent_end'))
}
