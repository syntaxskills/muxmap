let input = ''
for await (const chunk of process.stdin) input += chunk
const tmuxPane = process.env.TMUX_PANE
const kind = process.argv[2]

if (tmuxPane && ['codex', 'claude'].includes(kind)) {
  try {
    await fetch(`${process.env.MUXMAP_URL ?? 'http://127.0.0.1:4782'}/api/agent-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-muxmap-hook': '1' },
      body: JSON.stringify({ kind, tmuxPane, event: input ? JSON.parse(input) : {} }),
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // Agent work must never depend on the optional MuxMap observer.
  }
}
