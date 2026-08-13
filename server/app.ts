import { randomUUID, timingSafeEqual } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawn as spawnPty } from 'node-pty'
import { WebSocketServer, type WebSocket } from 'ws'
import type { TerminalBackend, TerminalSession } from '../src/model.ts'
import {
  createSessionManager,
  defaultTerminalBackend,
  defaultTmuxArgs,
  defaultTmuxEnv,
  defaultZellijEnv,
  realTmux,
  realZellij,
  tmuxExecutable,
  zellijConfigPath,
  zellijExecutable,
  type MultiplexerAdapters,
  type TmuxAdapter,
} from './sessions.ts'
import { createStore } from './store.ts'
import type { ProcessInfo } from './agents.ts'
import { terminalBackendsForPlatform, type RuntimePlatform } from '../src/settings.ts'

export type PtyHandle = {
  onData(listener: (data: string) => void): void
  onExit(listener: () => void): void
  write(data: string): void
  scroll(lines: number): void
  resize(cols: number, rows: number): void
  kill(): void
}

type TerminalSize = { cols: number; rows: number }

export type PtyFactory = (session: TerminalSession, size?: TerminalSize) => PtyHandle

type ServerOptions = {
  databasePath: string
  allowedRoots: string[]
  token?: string
  requireBasicAuth?: boolean
  tmux?: TmuxAdapter
  multiplexers?: MultiplexerAdapters
  defaultBackend?: TerminalBackend
  ptyFactory?: PtyFactory
  staticDirectory?: string
  allowedOrigins?: string[]
  processReader?: () => ProcessInfo[]
  platform?: RuntimePlatform
  activityWriteIntervalMs?: number
  attachmentsDirectory?: string
}

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const browserPreviewMimeTypes: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const textPreviewExtensions = new Set([
  '.bash', '.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.env', '.fish', '.go', '.h', '.hpp',
  '.html', '.java', '.js', '.json', '.jsx', '.kt', '.lock', '.log', '.md', '.mdx', '.mjs',
  '.php', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.swift', '.toml', '.ts', '.tsx',
  '.txt', '.yaml', '.yml', '.zsh',
])

const attachmentTypes: Record<string, string> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function tmuxPtyFallbackCommand(tmux: string, args: string[]) {
  return `exec ${[tmux, ...args].map(shellQuote).join(' ')}`
}

function spawnTmuxPty(tmux: string, args: string[], session: TerminalSession, size: TerminalSize) {
  const options = {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: session.cwd,
    env: { ...defaultTmuxEnv(), TERM: 'xterm-256color' } as Record<string, string>,
  }
  try {
    return spawnPty(tmux, args, options)
  } catch (error) {
    if (process.platform === 'win32') throw error
    return spawnPty('/bin/sh', ['-lc', tmuxPtyFallbackCommand(tmux, args)], options)
  }
}

export const defaultPtyFactory: PtyFactory = (session, size = { cols: 100, rows: 30 }) => {
  if (session.backend === 'zellij') {
    const pty = spawnPty(zellijExecutable(), ['--config', zellijConfigPath(), 'attach', '--create', session.runtimeName], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: session.cwd,
      env: { ...defaultZellijEnv(), TERM: 'xterm-256color' } as Record<string, string>,
      useConptyDll: process.platform === 'win32',
    })
    return {
      onData: (listener) => { pty.onData(listener) },
      onExit: (listener) => { pty.onExit(listener) },
      write: (data) => { pty.write(data) },
      scroll: (lines) => {
        const count = Math.min(200, Math.abs(Math.trunc(lines)))
        if (count) pty.write(`\x1b[<${lines < 0 ? 64 : 65};1;1M`.repeat(Math.ceil(count / 3)))
      },
      resize: (cols, rows) => { pty.resize(cols, rows) },
      kill: () => { pty.kill() },
    }
  }
  const tmux = tmuxExecutable()
  const mouse = spawnSync(tmux, defaultTmuxArgs('set-option', '-t', session.runtimeName, 'mouse', 'on'), { encoding: 'utf8', env: defaultTmuxEnv() })
  if (mouse.status !== 0) throw new Error(mouse.stderr.trim() || 'Unable to enable tmux scrolling')
  const pty = spawnTmuxPty(tmux, defaultTmuxArgs('attach-session', '-t', session.runtimeName), session, size)
  return {
    onData: (listener) => { pty.onData(listener) },
    onExit: (listener) => { pty.onExit(listener) },
    write: (data) => { pty.write(data) },
    scroll: (lines) => {
      const count = Math.min(200, Math.abs(Math.trunc(lines)))
      if (!count) return
      if (lines < 0) {
        const mode = spawnSync('tmux', defaultTmuxArgs('display-message', '-p', '-t', session.runtimeName, '#{pane_in_mode}'), { encoding: 'utf8', env: defaultTmuxEnv() })
        if (mode.stdout.trim() !== '1') spawnSync('tmux', defaultTmuxArgs('copy-mode', '-e', '-t', session.runtimeName), { env: defaultTmuxEnv() })
      }
      spawnSync('tmux', defaultTmuxArgs('send-keys', '-X', '-N', String(count), '-t', session.runtimeName, lines < 0 ? 'scroll-up' : 'scroll-down'), { env: defaultTmuxEnv() })
    },
    resize: (cols, rows) => { pty.resize(cols, rows) },
    kill: () => { pty.kill() },
  }
}

function cookieValue(request: IncomingMessage, name: string) {
  const cookies = request.headers.cookie?.split(';') ?? []
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
}

function hasBasicToken(request: IncomingMessage, token: string) {
  const encoded = request.headers.authorization?.match(/^Basic (.+)$/i)?.[1]
  if (encoded === undefined) return false
  const supplied = Buffer.from(encoded, 'base64')
  const expected = Buffer.from(`muxmap:${token}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function expandHome(path: string) {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\')
    ? join(homedir(), path.slice(2))
    : path
}

function isWithinRoot(candidate: string, root: string) {
  const offset = relative(root, candidate)
  return offset === '' || (!!offset && !offset.startsWith('..') && !isAbsolute(offset))
}

function safeFilePath(inputPath: string | null, inputCwd: string | null, allowedRoots: string[]) {
  if (!inputPath?.trim()) throw new Error('File path is required')
  const roots = allowedRoots.map((root) => realpathSync(resolve(expandHome(root)))).filter(Boolean)
  if (roots.length === 0) throw new Error('No allowed file roots configured')
  const cwd = inputCwd?.trim()
    ? realpathSync(resolve(expandHome(inputCwd)))
    : roots[0]
  if (!roots.some((root) => isWithinRoot(cwd, root))) throw new Error('Working directory is outside allowed roots')
  const candidate = realpathSync(isAbsolute(expandHome(inputPath)) ? resolve(expandHome(inputPath)) : resolve(cwd, expandHome(inputPath)))
  if (!roots.some((root) => isWithinRoot(candidate, root))) throw new Error('File path is outside allowed roots')
  const stat = statSync(candidate)
  if (!stat.isFile()) throw new Error('Path is not a file')
  return { path: candidate, size: stat.size }
}

function filePreviewHtml(path: string, content: string, line: number | undefined, column: number | undefined) {
  const rows = content.split(/\r?\n/).map((row, index) => {
    const number = index + 1
    const selected = line === number
    return `<tr id="L${number}"${selected ? ' class="is-selected"' : ''}><th>${number}</th><td><code>${htmlEscape(row || ' ')}</code></td></tr>`
  }).join('')
  const escapedPath = htmlEscape(path)
  const script = line ? `<script>document.getElementById('L${line}')?.scrollIntoView({block:'center'});</script>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(basename(path))}</title><style>
body{margin:0;background:#111411;color:#dce2db;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
header{position:sticky;top:0;z-index:1;padding:10px 14px;background:#191d18;border-bottom:1px solid #2d352c;color:#aeb8ad}
header strong{display:block;color:#f0f4ef;font-size:14px}header span{font-size:12px}
table{border-collapse:collapse;width:100%}th{width:1%;padding:0 12px;color:#657064;text-align:right;user-select:none;border-right:1px solid #262d25}
td{padding:0 14px;white-space:pre}tr.is-selected{background:#31401f}tr.is-selected th{color:#d8ef9a}
</style></head><body><header><strong>${htmlEscape(basename(path))}</strong><span>${escapedPath}${line ? `:${line}${column ? `:${column}` : ''}` : ''}</span></header><table>${rows}</table>${script}</body></html>`
}

async function readJson(request: IncomingMessage, maxBytes = 64 * 1024) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function attachmentDirectory(databasePath: string, configured?: string) {
  return resolve(configured ?? (databasePath === ':memory:' ? '.muxmap/attachments' : join(dirname(resolve(databasePath)), 'attachments')))
}

function decodeImageDataUrl(dataUrl: unknown, type: unknown) {
  if (typeof dataUrl !== 'string' || typeof type !== 'string') throw new Error('Image data and type are required')
  const extension = attachmentTypes[type]
  if (!extension) throw new Error('Unsupported image type')
  const prefix = `data:${type};base64,`
  if (!dataUrl.startsWith(prefix)) throw new Error('Invalid image data')
  const data = Buffer.from(dataUrl.slice(prefix.length), 'base64')
  if (data.length === 0) throw new Error('Image data is empty')
  if (data.length > 8 * 1024 * 1024) throw new Error('Image is too large')
  return { data, extension }
}

function attachmentContentType(name: string) {
  const extension = extname(name).toLowerCase()
  return Object.entries(attachmentTypes).find(([, value]) => value === extension)?.[0]
}

function isAllowedOrigin(request: IncomingMessage, extra: string[]) {
  const origin = request.headers.origin
  if (!origin) return false
  const host = request.headers.host
  return origin === `http://${host}` || origin === `https://${host}` || extra.includes(origin)
}

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function createMuxMapServer(options: ServerOptions) {
  const token = options.token ?? process.env.MUXMAP_TOKEN ?? randomUUID()
  const requireBasicAuth = options.requireBasicAuth ?? false
  const store = createStore(options.databasePath)
  const multiplexers = options.multiplexers ?? (options.tmux
    ? { tmux: Object.assign(options.tmux, { backend: 'tmux' as const }) }
    : { tmux: realTmux, zellij: realZellij })
  const platform = options.platform ?? process.platform
  const sessions = createSessionManager(store, multiplexers, options.allowedRoots, options.processReader, options.defaultBackend ?? defaultTerminalBackend(platform), platform)
  const ptyFactory = options.ptyFactory ?? defaultPtyFactory
  const staticDirectory = resolve(options.staticDirectory ?? 'dist')
  const allowedOrigins = options.allowedOrigins ?? []
  const webSockets = new WebSocketServer({ noServer: true })
  const clients = new Map<string, number>()
  const ptys = new Map<string, Set<PtyHandle>>()
  const lastActivityWrites = new Map<string, number>()
  const activityWriteIntervalMs = options.activityWriteIntervalMs ?? 5_000
  const attachmentsDirectory = attachmentDirectory(options.databasePath, options.attachmentsDirectory)
  let closing = false

  const recordSessionActivity = (sessionId: string) => {
    if (closing) return
    const now = Date.now()
    if (now - (lastActivityWrites.get(sessionId) ?? 0) < activityWriteIntervalMs) return
    lastActivityWrites.set(sessionId, now)
    store.updateSessionActivity(sessionId, new Date(now).toISOString())
  }

  sessions.reconcile()

  const http = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

    try {
      if (request.method === 'POST' && url.pathname === '/api/agent-events') {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
        if ((!local && !hasBasicToken(request, token)) || request.headers.origin || request.headers['x-muxmap-hook'] !== '1') return sendJson(response, 403, { error: 'Local or authenticated hook required' })
        const body = await readJson(request)
        const locator = body.locator && typeof body.locator === 'object'
          ? body.locator as Record<string, unknown>
          : typeof body.tmuxPane === 'string' ? { backend: 'tmux', paneId: body.tmuxPane } : undefined
        if (!['codex', 'claude', 'pi'].includes(String(body.kind)) || !locator || !['tmux', 'zellij'].includes(String(locator.backend)) || !body.event || typeof body.event !== 'object') {
          throw new Error('kind, terminal locator, and event are required')
        }
        const activity = sessions.recordAgentEvent(locator as import('./sessions.ts').AgentLocator, body.kind as 'codex' | 'claude' | 'pi', body.event as Record<string, unknown>)
        return sendJson(response, 202, { activity })
      }

      if (requireBasicAuth && cookieValue(request, 'muxmap_token') !== token && !hasBasicToken(request, token)) {
        response.setHeader('www-authenticate', 'Basic realm="MuxMap", charset="UTF-8"')
        return sendJson(response, 401, { error: 'Authentication required' })
      }

      if (request.method === 'GET' && url.pathname === '/api/auth') {
        response.setHeader('set-cookie', `muxmap_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`)
        return sendJson(response, 200, { authenticated: true })
      }

      if (url.pathname.startsWith('/api/')) {
        if (cookieValue(request, 'muxmap_token') !== token) return sendJson(response, 401, { error: 'Unauthorized' })
        if (request.method !== 'GET' && !isAllowedOrigin(request, allowedOrigins)) {
          return sendJson(response, 403, { error: 'Origin not allowed' })
        }

        if (request.method === 'GET' && url.pathname === '/api/files/open') {
          const file = safeFilePath(url.searchParams.get('path'), url.searchParams.get('cwd'), options.allowedRoots)
          const extension = extname(file.path).toLowerCase()
          const browserMimeType = browserPreviewMimeTypes[extension]
          if (browserMimeType) {
            response.writeHead(200, { 'content-type': browserMimeType, 'content-length': file.size })
            return response.end(readFileSync(file.path))
          }
          if (!textPreviewExtensions.has(extension) && file.size > 1024 * 1024) throw new Error('File is too large to preview')
          const line = Number(url.searchParams.get('line'))
          const column = Number(url.searchParams.get('column'))
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          return response.end(filePreviewHtml(
            file.path,
            readFileSync(file.path, 'utf8'),
            Number.isInteger(line) && line > 0 ? line : undefined,
            Number.isInteger(column) && column > 0 ? column : undefined,
          ))
        }

        if (request.method === 'POST' && url.pathname === '/api/attachments') {
          const body = await readJson(request, 12 * 1024 * 1024)
          const image = decodeImageDataUrl(body.dataUrl, body.type)
          mkdirSync(attachmentsDirectory, { recursive: true })
          const name = `${randomUUID()}${image.extension}`
          const path = join(attachmentsDirectory, name)
          writeFileSync(path, image.data, { flag: 'wx' })
          return sendJson(response, 201, {
            url: `/api/attachments/${name}`,
            markdown: `![pasted image](/api/attachments/${name})`,
          })
        }

        const attachmentMatch = url.pathname.match(/^\/api\/attachments\/([a-f0-9-]+\.(?:gif|jpg|png|webp))$/i)
        if (request.method === 'GET' && attachmentMatch) {
          const name = attachmentMatch[1]
          const type = attachmentContentType(name)
          if (!type) return sendJson(response, 404, { error: 'Not found' })
          const path = resolve(attachmentsDirectory, name)
          const root = resolve(attachmentsDirectory)
          if (!isWithinRoot(path, root) || !existsSync(path)) return sendJson(response, 404, { error: 'Not found' })
          response.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=31536000' })
          return response.end(readFileSync(path))
        }

        const workspaceMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)$/)
        if (request.method === 'GET' && workspaceMatch) {
          sessions.reconcile(new Set(clients.keys()))
          const inventory = sessions.inventory()
          const graph = store.getWorkspace(workspaceMatch[1])
          return sendJson(response, 200, { ...graph, sessions: sessions.decorate(graph.sessions, inventory), orphans: sessions.listOrphans(inventory), runtime: { platform, terminalBackends: terminalBackendsForPlatform(platform) } })
        }

        const nodeMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/nodes$/)
        if (request.method === 'POST' && nodeMatch) {
          const body = await readJson(request)
          const node = store.createNode(nodeMatch[1], {
            parentId: String(body.parentId ?? ''),
            title: String(body.title ?? ''),
            type: String(body.type ?? '') as import('../src/model.ts').NodeType,
            project: typeof body.project === 'string' ? body.project : undefined,
            color: typeof body.color === 'string' ? body.color : undefined,
            repoPath: typeof body.repoPath === 'string' ? body.repoPath : undefined,
            jiraKey: typeof body.jiraKey === 'string' ? body.jiraKey : undefined,
            note: typeof body.note === 'string' ? body.note : undefined,
          })
          const session = body.attachTerminal === true ? sessions.attach(node.id) : undefined
          return sendJson(response, 201, session ? { node, session } : node)
        }

        const attachMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/session$/)
        if (request.method === 'POST' && attachMatch) {
          const body = await readJson(request)
          if (body.backend !== undefined && !['tmux', 'zellij'].includes(String(body.backend))) throw new Error('Invalid terminal backend')
          return sendJson(response, 201, { session: sessions.attach(attachMatch[1], typeof body.cwd === 'string' ? body.cwd : undefined, body.backend as TerminalBackend | undefined) })
        }

        const reorderMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/reorder$/)
        if (request.method === 'POST' && reorderMatch) {
          const body = await readJson(request)
          if (typeof body.targetId !== 'string' || !['before', 'after'].includes(String(body.position))) throw new Error('targetId and a valid position are required')
          return sendJson(response, 200, { nodes: store.reorderNode(reorderMatch[1], body.targetId, body.position as 'before' | 'after') })
        }

        const archiveMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)\/(archive|restore)$/)
        if (request.method === 'POST' && archiveMatch) {
          const node = archiveMatch[2] === 'archive'
            ? store.archiveNode(archiveMatch[1])
            : store.restoreNode(archiveMatch[1])
          return sendJson(response, 200, { node })
        }

        const updateNodeMatch = url.pathname.match(/^\/api\/nodes\/([^/]+)$/)
        if (request.method === 'PATCH' && updateNodeMatch) {
          const body = await readJson(request)
          const input: Record<string, string> = {}
          for (const field of ['title', 'type', 'project', 'color', 'repoPath', 'jiraKey', 'note']) {
            if (body[field] === undefined) continue
            if (typeof body[field] !== 'string') throw new Error(`${field} must be a string`)
            input[field] = body[field]
          }
          return sendJson(response, 200, store.updateNode(updateNodeMatch[1], input))
        }
        if (request.method === 'DELETE' && updateNodeMatch) {
          const body = await readJson(request)
          if (typeof body.stopSession !== 'boolean') throw new Error('stopSession must be a boolean')
          const node = store.getNode(updateNodeMatch[1])
          if (!node) throw new Error('Node not found')
          const graph = store.getWorkspace(node.workspaceId)
          const nodeIds = new Set([node.id])
          let changed = true
          while (changed) {
            changed = false
            for (const child of graph.nodes) {
              if (child.parentId && nodeIds.has(child.parentId) && !nodeIds.has(child.id)) {
                nodeIds.add(child.id)
                changed = true
              }
            }
          }
          const branchSessions = graph.sessions.filter((session) => nodeIds.has(session.nodeId))
          if (body.stopSession) {
            for (const session of branchSessions) {
              for (const pty of ptys.get(session.id) ?? []) pty.kill()
              ptys.delete(session.id)
              sessions.stopRuntime(session.backend, session.runtimeName)
            }
          }
          const deletedNodeIds = store.deleteNode(node.id)
          return sendJson(response, 200, {
            deletedNodeIds,
            orphanedSessionNames: body.stopSession ? [] : branchSessions.map((session) => session.runtimeName),
          })
        }

        if (request.method === 'POST' && url.pathname === '/api/sessions/adopt-orphan') {
          const body = await readJson(request)
          if (typeof body.nodeId !== 'string' || !['tmux', 'zellij'].includes(String(body.backend)) || typeof body.runtimeName !== 'string') throw new Error('nodeId, backend, and runtimeName are required')
          return sendJson(response, 200, { session: sessions.adopt(body.nodeId, body.backend as TerminalBackend, body.runtimeName) })
        }

        if (request.method === 'POST' && url.pathname === '/api/sessions/stop-orphan') {
          const body = await readJson(request)
          if (!['tmux', 'zellij'].includes(String(body.backend)) || typeof body.runtimeName !== 'string') throw new Error('backend and runtimeName are required')
          sessions.stopRuntime(body.backend as TerminalBackend, body.runtimeName)
          return sendJson(response, 200, { stopped: body.runtimeName })
        }

        const stopMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/)
        if (request.method === 'POST' && stopMatch) {
          for (const pty of ptys.get(stopMatch[1]) ?? []) pty.kill()
          ptys.delete(stopMatch[1])
          return sendJson(response, 200, { session: sessions.stop(stopMatch[1]) })
        }

        const recoverCodexMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/recover-codex$/)
        if (request.method === 'POST' && recoverCodexMatch) {
          return sendJson(response, 200, { session: sessions.recoverCodex(recoverCodexMatch[1]) })
        }

        const acknowledgeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/agent\/read$/)
        if (request.method === 'POST' && acknowledgeMatch) {
          return sendJson(response, 200, { activity: sessions.acknowledge(acknowledgeMatch[1]) })
        }

        return sendJson(response, 404, { error: 'Not found' })
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
      }
      const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      let file = resolve(staticDirectory, requested)
      if (!file.startsWith(`${staticDirectory}${join('/')}`) || !existsSync(file) || statSync(file).isDirectory()) {
        file = join(staticDirectory, 'index.html')
      }
      if (!existsSync(file)) return sendJson(response, 503, { error: 'Frontend is not built. Run npm run build.' })
      response.writeHead(200, { 'content-type': mimeTypes[extname(file)] ?? 'application/octet-stream' })
      response.end(request.method === 'HEAD' ? undefined : readFileSync(file))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error'
      sendJson(response, /not found/i.test(message) ? 404 : 400, { error: message })
    }
  })

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/attach$/)
    if (!match) return rejectUpgrade(socket, 404, 'Not Found')
    if (cookieValue(request, 'muxmap_token') !== token) return rejectUpgrade(socket, 401, 'Unauthorized')
    if (!isAllowedOrigin(request, allowedOrigins)) return rejectUpgrade(socket, 403, 'Forbidden')
    const session = store.getSession(match[1])
    if (!session || session.status === 'stopped' || !sessions.exists(session)) {
      return rejectUpgrade(socket, 409, 'Session Not Running')
    }

    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request, session)
    })
  })

  webSockets.on('connection', (webSocket: WebSocket, request: IncomingMessage, session: TerminalSession) => {
    let pty: PtyHandle
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
      const cols = Number(url.searchParams.get('cols'))
      const rows = Number(url.searchParams.get('rows'))
      const size = Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && rows >= 1 && cols <= 500 && rows <= 200
        ? { cols, rows }
        : undefined
      pty = ptyFactory(session, size)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start terminal'
      store.updateSessionStatus(session.id, 'error')
      webSocket.send(JSON.stringify({ type: 'error', message }))
      webSocket.close(1011, 'Terminal unavailable')
      return
    }
    const handles = ptys.get(session.id) ?? new Set<PtyHandle>()
    handles.add(pty)
    ptys.set(session.id, handles)
    clients.set(session.id, (clients.get(session.id) ?? 0) + 1)
    sessions.markRunning(session.id)

    const send = (message: unknown) => {
      if (webSocket.readyState === webSocket.OPEN) webSocket.send(JSON.stringify(message))
    }
    pty.onData((data) => {
      send({ type: 'output', data })
      recordSessionActivity(session.id)
    })
    pty.onExit(() => send({ type: 'status', status: 'detached' }))
    send({ type: 'status', status: 'running' })

    webSocket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>
        if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 64 * 1024) {
          pty.write(message.data)
          recordSessionActivity(session.id)
        } else if (message.type === 'scroll') {
          const lines = Number(message.lines)
          if (Number.isInteger(lines) && lines !== 0 && Math.abs(lines) <= 200) pty.scroll(lines)
        } else if (message.type === 'resize') {
          const cols = Number(message.cols)
          const rows = Number(message.rows)
          if (Number.isInteger(cols) && Number.isInteger(rows) && cols >= 2 && rows >= 1 && cols <= 500 && rows <= 200) {
            pty.resize(cols, rows)
          }
        } else if (message.type === 'ping') {
          send({ type: 'status', status: 'running' })
        }
      } catch {
        send({ type: 'error', message: 'Invalid WebSocket message' })
      }
    })

    webSocket.on('close', () => {
      pty.kill()
      handles.delete(pty)
      if (handles.size === 0) ptys.delete(session.id)
      if (closing) return
      const remaining = Math.max(0, (clients.get(session.id) ?? 1) - 1)
      if (remaining === 0) {
        clients.delete(session.id)
        if (store.getSession(session.id)?.status !== 'stopped') sessions.detach(session.id)
      } else {
        clients.set(session.id, remaining)
      }
    })
  })

  return {
    store,
    listen(port: number, host = '127.0.0.1') {
      return new Promise<AddressInfo>((resolveListen, reject) => {
        http.once('error', reject)
        http.listen(port, host, () => resolveListen(http.address() as AddressInfo))
      })
    },
    close() {
      closing = true
      for (const handles of ptys.values()) for (const pty of handles) pty.kill()
      for (const client of webSockets.clients) client.close()
      return new Promise<void>((resolveClose, reject) => {
        http.close((error) => {
          store.close()
          if (error) reject(error)
          else resolveClose()
        })
      })
    },
  }
}
