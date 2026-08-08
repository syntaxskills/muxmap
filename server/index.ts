import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMuxMapServer } from './app.ts'

const port = Number(process.env.PORT ?? 4782)
const host = process.env.HOST ?? '127.0.0.1'
const token = process.env.MUXMAP_TOKEN
const remote = !['127.0.0.1', 'localhost', '::1'].includes(host)
if (remote && !token) throw new Error('MUXMAP_TOKEN is required when HOST is not localhost')
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
  requireBasicAuth: remote,
})

await muxmap.listen(port, host)
console.log(`MuxMap is running at http://${host}:${port}`)

async function shutdown() {
  await muxmap.close()
  process.exit(0)
}

process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
