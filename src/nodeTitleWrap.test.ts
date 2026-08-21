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

test('expanded node metadata stays bounded while preserving readable labels', () => {
  assert.match(css, /\.node-expanded-content\s*\{[^}]*gap:\s*3px/s)
  assert.match(css, /\.map-node\s*\{[^}]*transition:[^;}]*width 220ms/s)
  assert.match(css, /\.node-expanded-content > span\s*\{[^}]*grid-template-columns:\s*50px minmax\(0,\s*1fr\)/s)
  assert.match(css, /\.node-expanded-content > span\.is-wide\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
  assert.match(css, /\.node-expanded-content b\s*\{[^}]*white-space:\s*nowrap/s)
  assert.match(css, /\.node-expanded-content code,[\s\S]*\.node-expanded-content > span > span\s*\{[^}]*text-overflow:\s*ellipsis/s)
  assert.match(css, /\.node-expanded-content \.is-note em\s*\{[^}]*-webkit-line-clamp:\s*2/s)
  assert.doesNotMatch(css.match(/\.node-expanded-content code,[\s\S]*?\n\}/)?.[0] ?? '', /overflow-wrap:\s*anywhere/)
})
