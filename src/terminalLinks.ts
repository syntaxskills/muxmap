import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

type LinkOpener = (url: string) => void

const rawLinkPattern = /\b(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:localhost|127(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/[^\s<>"'`]*)?)/gi
const trailingPunctuation = /[),.;:!?]+$/

function stripTrailingPunctuation(value: string) {
  return value.replace(trailingPunctuation, '')
}

export function normalizeTerminalLink(raw: string) {
  const trimmed = stripTrailingPunctuation(raw.trim())
  if (!trimmed) return
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`
  if (/^(localhost|127(?:\.\d{1,3}){3})(?::\d{2,5})?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`
}

export function terminalLinksInLine(line: string) {
  const links: Array<{ text: string; url: string; start: number; end: number }> = []
  for (const match of line.matchAll(rawLinkPattern)) {
    const raw = match[0]
    const url = normalizeTerminalLink(raw)
    if (!url || match.index === undefined) continue
    const visibleText = stripTrailingPunctuation(raw)
    links.push({ text: visibleText, url, start: match.index, end: match.index + visibleText.length })
  }
  return links
}

export function createTerminalLinkProvider(terminal: Terminal, open: LinkOpener = openBrowserLink): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      try {
        const line = terminal.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true)
        if (!line) return callback(undefined)
        const links = terminalLinksInLine(line).map<ILink>((link) => ({
          text: link.text,
          range: { start: { x: link.start + 1, y: bufferLineNumber }, end: { x: link.end, y: bufferLineNumber } },
          decorations: { underline: true, pointerCursor: true },
          activate: () => open(link.url),
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
