import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

type LinkOpener = (url: string) => void
type LinkActivation = (link: { text: string; url: string }) => void
type TerminalLinkContext = string | { cwd?: string; sessionId?: string }

const terminalUrlBody = String.raw`[^\s<>"{}^⟨⟩` + "`" + String.raw`']+`
const terminalUrlPath = String.raw`[^\s<>"{}^⟨⟩` + "`" + String.raw`']*`
const localhostHost = String.raw`(?:localhost|127(?:\.\d{1,3}){3})`
const localDevLink = String.raw`${localhostHost}(?::\d{2,5})?(?:/${terminalUrlPath})?`
const rawLinkPattern = new RegExp(String.raw`\b(?:https?://${localDevLink}|${localDevLink}|https?://${terminalUrlBody}|www\.${terminalUrlBody})`, 'gi')
const sourceExtensions = String.raw`(?:bash|c|cc|cjs|cpp|cs|css|env|fish|gif|go|h|hpp|html|java|jpeg|jpg|js|json|jsx|kt|lock|log|md|mdx|mjs|pdf|php|png|py|rb|rs|scss|sh|sql|svg|swift|toml|ts|tsx|txt|webp|yaml|yml|zsh)`
const filePathBody = String.raw`[^\s<>"{}^⟨⟩` + "`" + String.raw`']*?`
const filePathPrefix = String.raw`(?:~[\\/]|\/|[A-Za-z]:[\\/]|\.{1,2}[\\/]|[A-Za-z0-9_.@-]+[\\/])`
const rawFilePattern = new RegExp(String.raw`(?:^|(?<=\s|[([{]))(${filePathPrefix}${filePathBody}\.${sourceExtensions}(?![A-Za-z0-9_])(?::\d{1,7}){0,2})`, 'gi')

type FileLocation = {
  path: string
  line?: number
  column?: number
}

function stripTrailingPunctuation(value: string) {
  let result = value
  let openParens = 0
  let closeParens = 0
  for (const char of result) {
    if (char === '(') openParens++
    if (char === ')') closeParens++
  }

  while (result) {
    const char = result.at(-1)
    if (char === undefined) break
    const shouldStrip =
      char === '.' ||
      char === ',' ||
      char === ':' ||
      char === ';' ||
      char === '(' ||
      (char === ')' && closeParens > openParens)
    if (!shouldStrip) break
    if (char === '(') openParens--
    if (char === ')') closeParens--
    result = result.slice(0, -1)
  }

  return result
}

export function normalizeTerminalLink(raw: string) {
  const trimmed = stripTrailingPunctuation(raw.trim())
  if (!trimmed) return
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  if (/^(localhost|127(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`
}

function linkContext(input?: TerminalLinkContext) {
  return typeof input === 'string' ? { cwd: input } : input ?? {}
}

function parseFileLocation(raw: string): FileLocation | undefined {
  let path = stripTrailingPunctuation(raw.trim())
  if (!path) return
  const numbers: number[] = []
  for (let index = 0; index < 2; index++) {
    const match = path.match(/:(\d{1,7})$/)
    if (!match) break
    numbers.unshift(Number(match[1]))
    path = path.slice(0, -match[0].length)
  }
  if (!path || /^[A-Za-z]:$/.test(path)) return
  const [line, column] = numbers
  return { path, line, column }
}

export function normalizeTerminalFileLink(raw: string, context?: TerminalLinkContext) {
  const location = parseFileLocation(raw)
  if (!location) return
  const { cwd, sessionId } = linkContext(context)
  const parameters = new URLSearchParams({ path: location.path })
  if (cwd) parameters.set('cwd', cwd)
  if (sessionId) parameters.set('sessionId', sessionId)
  if (location.line !== undefined) parameters.set('line', String(location.line))
  if (location.column !== undefined) parameters.set('column', String(location.column))
  return `/api/files/open?${parameters.toString()}`
}

function overlaps(start: number, end: number, links: Array<{ start: number; end: number }>) {
  return links.some((link) => start < link.end && end > link.start)
}

export function terminalLinksInLine(line: string, context?: TerminalLinkContext) {
  const links: Array<{ text: string; url: string; start: number; end: number }> = []
  for (const match of line.matchAll(rawLinkPattern)) {
    const raw = match[0]
    const url = normalizeTerminalLink(raw)
    if (!url || match.index === undefined) continue
    const visibleText = stripTrailingPunctuation(raw)
    links.push({ text: visibleText, url, start: match.index, end: match.index + visibleText.length })
  }
  for (const match of line.matchAll(rawFilePattern)) {
    const raw = match[1]
    if (!raw) continue
    const start = match.index === undefined ? undefined : match.index + match[0].length - raw.length
    if (start === undefined) continue
    const visibleText = stripTrailingPunctuation(raw)
    const end = start + visibleText.length
    if (overlaps(start, end, links)) continue
    const url = normalizeTerminalFileLink(visibleText, context)
    if (!url) continue
    links.push({ text: visibleText, url, start, end })
  }
  return links.sort((left, right) => left.start - right.start)
}

export function createTerminalLinkProvider(terminal: Terminal, context?: TerminalLinkContext, open: LinkOpener = openBrowserLink, onActivate?: LinkActivation): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      try {
        const line = terminal.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true)
        if (!line) return callback(undefined)
        const links = terminalLinksInLine(line, context).map<ILink>((link) => ({
          text: link.text,
          range: { start: { x: link.start + 1, y: bufferLineNumber }, end: { x: link.end, y: bufferLineNumber } },
          decorations: { underline: true, pointerCursor: true },
          activate: () => {
            onActivate?.({ text: link.text, url: link.url })
            open(link.url)
          },
        }))
        callback(links.length > 0 ? links : undefined)
      } catch {
        callback(undefined)
      }
    },
  }
}

function openBrowserLink(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}
