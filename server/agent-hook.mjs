let input = ''
for await (const chunk of process.stdin) input += chunk
const tmuxPane = process.env.TMUX_PANE
const zellijSession = process.env.ZELLIJ_SESSION_NAME
const kind = process.argv[2]
const locator = tmuxPane
  ? { backend: 'tmux', paneId: tmuxPane }
  : zellijSession ? { backend: 'zellij', runtimeName: zellijSession, paneId: process.env.ZELLIJ_PANE_ID } : undefined

if (locator && ['codex', 'claude'].includes(kind)) {
  try {
    const headers = { 'content-type': 'application/json', 'x-muxmap-hook': '1' }
    if (process.env.MUXMAP_TOKEN) headers.authorization = `Basic ${Buffer.from(`muxmap:${process.env.MUXMAP_TOKEN}`).toString('base64')}`
    await fetch(`${process.env.MUXMAP_URL ?? 'http://127.0.0.1:4782'}/api/agent-events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind, locator, event: input ? JSON.parse(input) : {} }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Agent work must never depend on the optional MuxMap observer.
  }
}
