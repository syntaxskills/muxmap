import type { TerminalSession } from './model.ts'

export function sessionActivityTimestamp(session: TerminalSession) {
  return session.lastActivityAt ?? session.lastAttachedAt ?? session.createdAt
}

export function formatActivityAge(timestamp: string | undefined, now = Date.now()) {
  if (!timestamp) return ''
  const then = Date.parse(timestamp)
  if (!Number.isFinite(then)) return ''
  const elapsed = Math.max(0, now - then)
  if (elapsed < 60_000) return 'NOW'
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}M`
  if (elapsed < 48 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}H`
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}d`
}
