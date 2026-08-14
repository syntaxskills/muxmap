import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerminalLinkProvider, normalizeTerminalFileLink, normalizeTerminalLink, terminalLinksInLine } from './terminalLinks.ts'

test('terminal links normalize browser URLs and local dev URLs', () => {
  assert.equal(normalizeTerminalLink('https://example.com/a?b=1.'), 'https://example.com/a?b=1')
  assert.equal(normalizeTerminalLink('https://example.com/search?q=what?'), 'https://example.com/search?q=what?')
  assert.equal(normalizeTerminalLink('http://localhost:5173/path'), 'http://localhost:5173/path')
  assert.equal(normalizeTerminalLink('localhost:4782/api'), 'http://localhost:4782/api')
  assert.equal(normalizeTerminalLink('127.0.0.1:4782'), 'http://127.0.0.1:4782')
  assert.equal(normalizeTerminalLink('www.example.com/docs'), 'https://www.example.com/docs')
  assert.equal(normalizeTerminalLink('/Users/me/repo'), undefined)
})

test('terminal links normalize source file paths into browser preview URLs', () => {
  assert.equal(
    normalizeTerminalFileLink('/Users/me/repo/src/App.tsx:12:4'),
    '/api/files/open?path=%2FUsers%2Fme%2Frepo%2Fsrc%2FApp.tsx&line=12&column=4',
  )
  assert.equal(
    normalizeTerminalFileLink('src/TerminalPanel.tsx:90', '/Users/me/repo'),
    '/api/files/open?path=src%2FTerminalPanel.tsx&cwd=%2FUsers%2Fme%2Frepo&line=90',
  )
  assert.equal(
    normalizeTerminalFileLink('my_ignore/swimlane_apm_direct_requests.md', { cwd: '/Users/me/repo/project', sessionId: 'sess_terminal' }),
    '/api/files/open?path=my_ignore%2Fswimlane_apm_direct_requests.md&cwd=%2FUsers%2Fme%2Frepo%2Fproject&sessionId=sess_terminal',
  )
  assert.equal(
    normalizeTerminalFileLink('C:\\repo\\muxmap\\src\\App.tsx:8'),
    '/api/files/open?path=C%3A%5Crepo%5Cmuxmap%5Csrc%5CApp.tsx&line=8',
  )
})

test('terminal links keep terminal buffer coordinates for xterm', () => {
  assert.deepEqual(terminalLinksInLine('open https://example.com/docs, then localhost:4782'), [
    { text: 'https://example.com/docs', url: 'https://example.com/docs', start: 5, end: 29 },
    { text: 'localhost:4782', url: 'http://localhost:4782', start: 36, end: 50 },
  ])
  assert.deepEqual(terminalLinksInLine('at src/App.tsx:42 and /repo/server/app.ts', '/repo'), [
    { text: 'src/App.tsx:42', url: '/api/files/open?path=src%2FApp.tsx&cwd=%2Frepo&line=42', start: 3, end: 17 },
    { text: '/repo/server/app.ts', url: '/api/files/open?path=%2Frepo%2Fserver%2Fapp.ts&cwd=%2Frepo', start: 22, end: 41 },
  ])
})

test('terminal links stop local dev URLs before adjacent terminal text', () => {
  assert.deepEqual(terminalLinksInLine('served at http://localhost:5173Home'), [
    { text: 'http://localhost:5173', url: 'http://localhost:5173', start: 10, end: 31 },
  ])
  assert.deepEqual(terminalLinksInLine('open http://127.0.0.1:4782Home'), [
    { text: 'http://127.0.0.1:4782', url: 'http://127.0.0.1:4782', start: 5, end: 26 },
  ])
  assert.deepEqual(terminalLinksInLine('open http://localhost:5173/Home'), [
    { text: 'http://localhost:5173/Home', url: 'http://localhost:5173/Home', start: 5, end: 31 },
  ])
  assert.deepEqual(terminalLinksInLine('at src/App.tsxHome prompt'), [])
})

test('terminal link provider opens the clicked link in a browser tab', async () => {
  const opened: string[] = []
  const terminal = {
    buffer: {
      active: {
        getLine(y: number) {
          assert.equal(y, 2)
          return { translateToString: () => 'visit www.example.com/docs' }
        },
      },
    },
  }
  const provider = createTerminalLinkProvider(terminal as never, undefined, (url) => opened.push(url))
  const links = await new Promise<unknown[]>((resolve) => provider.provideLinks(3, (items) => resolve(items ?? [])))

  assert.equal(links.length, 1)
  assert.deepEqual((links[0] as { range: unknown }).range, { start: { x: 7, y: 3 }, end: { x: 26, y: 3 } })
  ;(links[0] as { activate: () => void }).activate()
  assert.deepEqual(opened, ['https://www.example.com/docs'])
})

test('terminal link provider opens source file links in a browser tab', async () => {
  const opened: string[] = []
  const terminal = {
    buffer: {
      active: {
        getLine() {
          return { translateToString: () => 'error src/terminalLinks.ts:33' }
        },
      },
    },
  }
  const provider = createTerminalLinkProvider(terminal as never, '/repo/muxmap', (url) => opened.push(url))
  const links = await new Promise<unknown[]>((resolve) => provider.provideLinks(1, (items) => resolve(items ?? [])))

  assert.equal(links.length, 1)
  ;(links[0] as { activate: () => void }).activate()
  assert.deepEqual(opened, ['/api/files/open?path=src%2FterminalLinks.ts&cwd=%2Frepo%2Fmuxmap&line=33'])
})

test('terminal link provider includes session id so file links can resolve against live cwd', async () => {
  const opened: string[] = []
  const terminal = {
    buffer: {
      active: {
        getLine() {
          return { translateToString: () => 'open my_ignore/swimlane_apm_direct_requests.md' }
        },
      },
    },
  }
  const provider = createTerminalLinkProvider(terminal as never, { cwd: '/repo/project', sessionId: 'sess_live' }, (url) => opened.push(url))
  const links = await new Promise<unknown[]>((resolve) => provider.provideLinks(1, (items) => resolve(items ?? [])))

  assert.equal(links.length, 1)
  ;(links[0] as { activate: () => void }).activate()
  assert.deepEqual(opened, ['/api/files/open?path=my_ignore%2Fswimlane_apm_direct_requests.md&cwd=%2Frepo%2Fproject&sessionId=sess_live'])
})

test('terminal link provider returns no links when the buffer line is unavailable', async () => {
  const provider = createTerminalLinkProvider({ buffer: { active: { getLine: () => { throw new Error('buffer changed') } } } } as never)
  const links = await new Promise<unknown[] | undefined>((resolve) => provider.provideLinks(1, resolve))
  assert.equal(links, undefined)
})
