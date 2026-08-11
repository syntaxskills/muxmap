import { spawnSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

export type AccessMode = 'local' | 'lan' | 'tailscale'
export type NetworkAccess = { mode: AccessMode; host: string; requireBasicAuth: boolean }
export type AuthMode = 'password' | 'none'

function isTailscaleIPv4(address: string) {
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

export function detectTailscaleIPv4() {
  const result = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Tailscale IPv4 unavailable. Install Tailscale, sign in, and run "tailscale ip -4".')
  return parseTailscaleIPv4(result.stdout)
}

export function parseTailscaleIPv4(output: string) {
  const address = output.trim().split(/\s+/)[0]
  if (!address || !isTailscaleIPv4(address)) throw new Error('Tailscale IPv4 unavailable. Install Tailscale, sign in, and run "tailscale ip -4".')
  return address
}

export function requestedAccessMode(env: NodeJS.ProcessEnv): string {
  return env.MUXMAP_ACCESS ?? (env.HOST === '0.0.0.0' ? 'lan' : 'local')
}

export function requestedAuthMode(env: NodeJS.ProcessEnv): string {
  return env.MUXMAP_AUTH ?? 'password'
}

export function resolveNetworkAccess(mode: string, token?: string, tailscaleIPv4?: string, authMode = 'password'): NetworkAccess {
  if (!['local', 'lan', 'tailscale'].includes(mode)) throw new Error('MUXMAP_ACCESS must be local, lan, or tailscale')
  if (!['password', 'none'].includes(authMode)) throw new Error('MUXMAP_AUTH must be password or none')
  if (mode !== 'local' && authMode === 'password' && !token) throw new Error('MUXMAP_TOKEN is required for lan and tailscale access')
  if (mode === 'tailscale' && (!tailscaleIPv4 || !isTailscaleIPv4(tailscaleIPv4))) throw new Error('A valid Tailscale IPv4 address is required')
  return {
    mode: mode as AccessMode,
    host: mode === 'local' ? '127.0.0.1' : mode === 'lan' ? '0.0.0.0' : tailscaleIPv4!,
    requireBasicAuth: mode !== 'local' && authMode === 'password',
  }
}

export function accessUrls(access: NetworkAccess, port: number, lanAddresses?: string[]) {
  if (access.mode === 'local') return [`http://127.0.0.1:${port}`]
  if (access.mode === 'tailscale') return [`http://${access.host}:${port}`]
  const addresses = lanAddresses ?? Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
  return [...new Set(['127.0.0.1', ...addresses])].map((address) => `http://${address}:${port}`)
}
