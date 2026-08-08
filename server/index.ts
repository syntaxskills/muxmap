import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMuxMapServer } from './app.ts'
import { accessUrls, detectTailscaleIPv4, requestedAccessMode, resolveNetworkAccess } from './network.ts'

const port = Number(process.env.PORT ?? 4782)
const token = process.env.MUXMAP_TOKEN
const mode = requestedAccessMode(process.env)
const access = resolveNetworkAccess(mode, token, mode === 'tailscale' ? detectTailscaleIPv4() : undefined)
const dataDirectory = resolve(process.env.MUXMAP_DATA_DIR ?? '.muxmap')
const allowedRoots = (process.env.MUXMAP_ALLOWED_ROOTS ?? resolve('..')).split(',').map((root) => resolve(root.trim()))
const allowedOrigins = (process.env.MUXMAP_ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',').filter(Boolean)
mkdirSync(dataDirectory, { recursive: true })

const muxmap = createMuxMapServer({
  databasePath: resolve(dataDirectory, 'muxmap.db'),
  allowedRoots,
  allowedOrigins,
  staticDirectory: resolve('dist'),
  token,
  requireBasicAuth: access.requireBasicAuth,
})

await muxmap.listen(port, access.host)
console.log(`MuxMap access mode: ${access.mode}`)
console.log(`MuxMap listening on ${access.host}:${port}`)
for (const url of accessUrls(access, port)) console.log(`MuxMap open: ${url}`)
if (access.requireBasicAuth) console.log('MuxMap Basic Auth: username "muxmap", password MUXMAP_TOKEN')
if (access.mode === 'tailscale') console.log(`For tailnet HTTPS instead, use local mode and run: tailscale serve --bg ${port}`)

async function shutdown() {
  await muxmap.close()
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
