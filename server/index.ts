import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMuxMapServer } from './app.ts'
import { loadMuxMapConfig } from './config.ts'
import { detectOpenFileLimit, openFileLimitDiagnostic } from './limits.ts'
import { accessUrls, detectTailscaleIPv4, requestedAccessMode, requestedAuthMode, resolveNetworkAccess } from './network.ts'

const port = Number(process.env.PORT ?? 4782)
const token = process.env.MUXMAP_TOKEN
const mode = requestedAccessMode(process.env)
const authMode = requestedAuthMode(process.env)
const access = resolveNetworkAccess(mode, token, mode === 'tailscale' ? detectTailscaleIPv4() : undefined, authMode)
const dataDirectory = resolve(process.env.MUXMAP_DATA_DIR ?? '.muxmap')
const allowedRoots = (process.env.MUXMAP_ALLOWED_ROOTS ?? resolve('..')).split(',').map((root) => resolve(root.trim()))
const allowedOrigins = (process.env.MUXMAP_ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').filter(Boolean)
const config = loadMuxMapConfig(process.env, process.cwd())
mkdirSync(dataDirectory, { recursive: true })

const muxmap = createMuxMapServer({
  databasePath: resolve(dataDirectory, 'muxmap.db'),
  allowedRoots,
  allowedOrigins,
  staticDirectory: resolve('dist'),
  token,
  requireBasicAuth: access.requireBasicAuth,
  nodeStepDefinitions: config.nodeStepDefinitions,
})

await muxmap.listen(port, access.host)
console.log(`MuxMap access mode: ${access.mode}`)
console.log(`MuxMap listening on ${access.host}:${port}`)
for (const url of accessUrls(access, port)) console.log(`MuxMap open: ${url}`)
if (access.requireBasicAuth) console.log('MuxMap Basic Auth: username "muxmap", password MUXMAP_TOKEN')
if (access.mode !== 'local' && !access.requireBasicAuth) console.warn('MuxMap warning: network access has no password authentication')
if (access.mode === 'tailscale') console.log(`For tailnet HTTPS instead, use local mode and run: tailscale serve --bg ${port}`)
console.log(`MuxMap node steps: ${config.nodeStepDefinitions.map((step) => step.key).join(' -> ')}${config.source ? ` (${config.source})` : ''}`)
const limitDiagnostic = openFileLimitDiagnostic(detectOpenFileLimit())
if (limitDiagnostic?.message) console[limitDiagnostic.ok ? 'log' : 'warn'](`MuxMap ${limitDiagnostic.message}`)

async function shutdown() {
  await muxmap.close()
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
