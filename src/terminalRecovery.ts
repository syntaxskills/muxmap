export function attachTerminalRecovery(socket: WebSocket, isDisconnected: () => boolean, reconnect: () => void) {
  let disposed = false
  let reconnecting = false
  let probeTimer: ReturnType<typeof setTimeout> | undefined
  const clearProbe = () => {
    clearTimeout(probeTimer)
    probeTimer = undefined
  }
  const canRecover = () => !disposed && !reconnecting && document.visibilityState === 'visible' && navigator.onLine
  const recover = () => {
    clearProbe()
    if (!canRecover()) return
    reconnecting = true
    reconnect()
  }
  const check = () => {
    if (!canRecover()) { clearProbe(); return }
    if (isDisconnected() || socket.readyState >= WebSocket.CLOSING) { recover(); return }
    if (probeTimer !== undefined) return
    // A socket can still appear OPEN after sleep or a silent network drop.
    probeTimer = setTimeout(recover, 5000)
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }))
  }
  window.addEventListener('focus', check)
  window.addEventListener('online', check)
  window.addEventListener('pageshow', check)
  document.addEventListener('visibilitychange', check)
  socket.addEventListener('message', clearProbe)
  return () => {
    disposed = true
    clearProbe()
    window.removeEventListener('focus', check)
    window.removeEventListener('online', check)
    window.removeEventListener('pageshow', check)
    document.removeEventListener('visibilitychange', check)
    socket.removeEventListener('message', clearProbe)
  }
}
