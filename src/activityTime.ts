import type { TerminalSession } from './model.ts'

export type ActivityStaleness = 'fresh' | 'aging' | 'stale'
export type ActivityStalenessOptions = {
  enabled?: boolean
  inactiveAfterHours?: number
  oldestPercent?: number
}

const hourMs = 60 * 60_000
const defaultInactiveAfterHours = 36
const defaultOldestPercent = 50

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

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function activityStaleness(
  timestamp: string | undefined,
  allTimestamps: Array<string | undefined>,
  now = Date.now(),
  options: ActivityStalenessOptions = {},
): ActivityStaleness {
  if (options.enabled === false) return 'fresh'
  if (!timestamp) return 'fresh'
  const then = Date.parse(timestamp)
  if (!Number.isFinite(then) || then >= now) return 'fresh'
  const inactiveAfterMs = boundedNumber(options.inactiveAfterHours, defaultInactiveAfterHours, 1, 720) * hourMs
  if (now - then < inactiveAfterMs) return 'fresh'

  const ranked = allTimestamps
    .map((value) => value ? Date.parse(value) : NaN)
    .filter((value) => Number.isFinite(value) && value <= now)
    .sort((a, b) => a - b)
  if (ranked.length < 2) return 'fresh'

  const oldestPercent = boundedNumber(options.oldestPercent, defaultOldestPercent, 1, 100)
  const dimmedCount = Math.max(1, Math.floor(ranked.length * (oldestPercent / 100)))
  const newestDimmedTimestamp = ranked[dimmedCount - 1]
  if (then > newestDimmedTimestamp) return 'fresh'

  const deepestStaleCount = Math.max(1, Math.floor(dimmedCount / 2))
  const newestStaleTimestamp = ranked[deepestStaleCount - 1]
  return then <= newestStaleTimestamp ? 'stale' : 'aging'
}
