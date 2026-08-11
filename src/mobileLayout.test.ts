import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('mobile terminal opens as an 80 percent bottom sheet with safe-area support', () => {
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
  const mobile = css.slice(css.indexOf('@media (max-width: 640px)'))
  assert.match(mobile, /\.terminal-window\.is-docked[\s\S]*position:\s*fixed/)
  assert.match(mobile, /\.terminal-window\.is-docked[\s\S]*bottom:\s*0/)
  assert.match(mobile, /\.terminal-window\.is-docked[\s\S]*height:\s*80dvh/)
  assert.match(mobile, /padding-bottom:\s*env\(safe-area-inset-bottom\)/)
  assert.match(mobile, /\.terminal-splitter\s*\{[\s\S]*display:\s*none/)

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /viewport-fit=cover/)
})
