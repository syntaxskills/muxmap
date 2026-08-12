import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'

type LinkOpener = (url: string) => void

const terminalUrlBody = String.raw`[^\s<>"{}^⟨⟩` + "`" + String.raw`']+`
const terminalUrlPath = String.raw`[^\s<>"{}^⟨⟩` + "`" + String.raw`']*`
const localhostHost = String.raw`(?:localhost|127(?:\.\d{1,3}){3})`
const localDevLink = String.raw`${localhostHost}(?::\d{2,5})?(?:/${terminalUrlPath})?`
const rawLinkPattern = new RegExp(String.raw`\b(?:https?://${localDevLink}|${localDevLink}|https?://${terminalUrlBody}|www\.${terminalUrlBody})`, 'gi')

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
