import { spawnSync } from 'node:child_process'

export function parseOpenFileLimit(output: string) {
  const trimmed = output.trim()
  if (trimmed === 'unlimited') return Number.POSITIVE_INFINITY
  const limit = Number(trimmed)
  return Number.isFinite(limit) && limit > 0 ? limit : undefined
}

export function detectOpenFileLimit(platform: NodeJS.Platform = process.platform) {
  if (platform === 'win32') return undefined
  const result = spawnSync('/bin/sh', ['-lc', 'ulimit -n'], { encoding: 'utf8' })
  return result.status === 0 ? parseOpenFileLimit(result.stdout) : undefined
}

export function openFileLimitDiagnostic(limit: number | undefined) {
  if (limit === undefined || limit === Number.POSITIVE_INFINITY) return undefined
  if (limit < 512) return { ok: true, message: `[WARNING] Open file limit is ${limit}. Run "ulimit -n 4096" before starting MuxMap; low limits can make node-pty fail with posix_spawnp failed.` }
  if (limit < 1024) return { ok: true, message: `[WARNING] Open file limit is ${limit}. If terminals fail with posix_spawnp failed, restart MuxMap after "ulimit -n 4096".` }
  return { ok: true, message: `[OK] Open file limit: ${limit}` }
}
