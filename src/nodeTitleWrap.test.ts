import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

test('node titles show up to two lines before truncating', () => {
  assert.match(
    css,
    /\.node-title\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-box-orient:\s*vertical;[^}]*-webkit-line-clamp:\s*2;[^}]*white-space:\s*normal;/s,
  )
})
