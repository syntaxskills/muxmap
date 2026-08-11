import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { accessUrls, parseTailscaleIPv4, requestedAccessMode, requestedAuthMode, resolveNetworkAccess, type AccessMode } from './network.ts'

type Interface = { address: string; family: string | number; internal: boolean; netmask: string }
type CommandResult = { status: number | null; stdout: string; stderr: string }
type DoctorSystem = {
  platform: NodeJS.Platform
  interfaces: Interface[]
  run(command: string, args: string[]): CommandResult
  portAvailable(host: string, port: number): Promise<boolean>
  writeFile(path: string, contents: string): void
}

const defaultSystem: DoctorSystem = {
  platform: process.platform,
  interfaces: Object.values(networkInterfaces()).flatMap((entries) => entries ?? []),
  run: (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  },
  portAvailable: (host, port) => new Promise((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.listen(port, host, () => server.close(() => done(true)))
  }),
  writeFile: (path, contents) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  },
}

function ipv4Number(address: string) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error(`Invalid IPv4 address: ${address}`)
  return parts.reduce((value, part) => (value * 256 + part) >>> 0, 0)
}

export function subnetCidr(address: string, netmask: string) {
  const mask = ipv4Number(netmask)
  const inverted = (~mask) >>> 0
  if ((inverted & (inverted + 1)) !== 0) throw new Error(`Invalid IPv4 netmask: ${netmask}`)
  const network = (ipv4Number(address) & mask) >>> 0
  const prefix = mask.toString(2).replace(/0/g, '').length
  return `${[24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join('.')}/${prefix}`
}

function isLanIPv4(address: string) {
  const [first, second] = address.split('.').map(Number)
  return first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168
}

function supportedZellijVersion(output: string) {
  const version = output.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
  return version !== undefined && (version[0] > 0 || version[1] > 44 || version[1] === 44 && version[2] >= 3)
}

function firewallName(mode: AccessMode, port: number) {
  return `MuxMap ${mode === 'lan' ? 'LAN' : 'Tailscale'} ${port}`
}

export function windowsFirewallScript(mode: AccessMode, port: number, remoteAddresses: string[]) {
  const name = firewallName(mode, port)
  const remotes = remoteAddresses.map((address) => `'${address}'`).join(', ')
  const profile = mode === 'lan' ? 'Private' : 'Any'
  return `# Run this file from Administrator PowerShell.\n$ruleName = '${name}'\nGet-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule\nNew-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -RemoteAddress ${remotes} -Profile ${profile}\n`
}

function firewallCheck(mode: AccessMode, port: number, remoteAddresses: string[]) {
  const name = firewallName(mode, port)
  const remotes = remoteAddresses.map((address) => `'${address}'`).join(',')
  const profile = mode === 'lan' ? 'Private' : 'Any'
  return `$r=Get-NetFirewallRule -DisplayName '${name}' -ErrorAction SilentlyContinue; if(!$r -or $r.Enabled -ne 'True' -or $r.Action -ne 'Allow' -or $r.Profile -ne '${profile}'){exit 1}; $p=$r|Get-NetFirewallPortFilter; if($p.Protocol -ne 'TCP' -or $p.LocalPort -ne '${port}'){exit 1}; $a=@($r|Get-NetFirewallAddressFilter|ForEach-Object RemoteAddress); if(Compare-Object @(${remotes}) $a){exit 1}`
}

export async function runDoctor(env: NodeJS.ProcessEnv, system: DoctorSystem = defaultSystem) {
  const lines: string[] = []
  const port = Number(env.PORT ?? 4782)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, lines: ['[ERROR] PORT must be an integer from 1 to 65535'] }
  const mode = requestedAccessMode(env)
  let tailscaleIPv4: string | undefined

  if (mode === 'tailscale') {
    const result = system.run('tailscale', ['ip', '-4'])
    if (result.status === 0) {
      try { tailscaleIPv4 = parseTailscaleIPv4(result.stdout) } catch (error) { lines.push(`[ERROR] ${(error as Error).message}`) }
    } else lines.push('[ERROR] Tailscale is unavailable. Install it, sign in, then run "tailscale ip -4".')
  }

  let access
  try {
    access = resolveNetworkAccess(mode, env.MUXMAP_TOKEN, tailscaleIPv4, requestedAuthMode(env))
  } catch (error) {
    lines.push(`[ERROR] ${(error as Error).message}`)
    return { ok: false, lines }
  }

  const ipv4 = system.interfaces.filter((entry) => (entry.family === 'IPv4' || entry.family === 4) && !entry.internal)
  lines.push(`[OK] Mode: ${access.mode}`)
  lines.push(`[OK] Listen: ${access.host}:${port}`)
  for (const url of accessUrls(access, port, ipv4.map((entry) => entry.address))) lines.push(`[OK] URL: ${url}`)
  if (access.requireBasicAuth) lines.push('[OK] Basic Auth: username "muxmap", password MUXMAP_TOKEN')
  if (access.mode !== 'local' && !access.requireBasicAuth) lines.push('[WARNING] Network access is running without password authentication')

  let ok = true
  if (await system.portAvailable(access.host, port)) lines.push(`[OK] Port ${port} is available`)
  else { ok = false; lines.push(`[ERROR] Port ${port} is already in use`) }

  if (system.platform === 'win32') {
    const zellij = system.run(env.MUXMAP_ZELLIJ_BIN ?? 'zellij.exe', ['--version'])
    if (zellij.status === 0 && supportedZellijVersion(zellij.stdout)) lines.push(`[OK] ${zellij.stdout.trim()}`)
    else { ok = false; lines.push('[ERROR] Zellij 0.44.3+ is required on Windows') }

    if (access.mode !== 'local') {
      const remoteAddresses = access.mode === 'tailscale'
        ? ['100.64.0.0/10']
        : [...new Set(ipv4.filter((entry) => isLanIPv4(entry.address)).map((entry) => subnetCidr(entry.address, entry.netmask)))]
      if (remoteAddresses.length === 0) {
        ok = false
        lines.push('[ERROR] No private LAN subnet found; firewall script was not generated')
      } else {
        const firewall = system.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', firewallCheck(access.mode, port, remoteAddresses)])
        if (firewall.status === 0) lines.push(`[OK] Windows Firewall restricts ${port} to ${remoteAddresses.join(', ')}`)
        else {
          ok = false
          const path = resolve(env.MUXMAP_DATA_DIR ?? '.muxmap', `muxmap-firewall-${access.mode}-${port}.ps1`)
          system.writeFile(path, windowsFirewallScript(access.mode, port, remoteAddresses))
          lines.push(`[ERROR] Windows Firewall rule missing or too broad. Run as Administrator: ${path}`)
        }
      }
    }
  }

  if (access.mode === 'tailscale') lines.push(`[OK] Alternative HTTPS proxy: tailscale serve --bg ${port}`)
  return { ok, lines }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runDoctor(process.env)
  console.log(result.lines.join('\n'))
  if (!result.ok) process.exitCode = 1
}
