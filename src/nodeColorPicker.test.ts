import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('node color picker persists and manages recent custom colors', () => {
  const picker = readFileSync(new URL('./NodeColorPicker.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(picker, /recentNodeColorsStorageKey/)
  assert.match(picker, /window\.localStorage\.getItem\(recentNodeColorsStorageKey\)/)
  assert.match(picker, /window\.localStorage\.setItem\(recentNodeColorsStorageKey/)
  assert.match(picker, /Recent custom/)
  assert.match(picker, /Clear/)
  assert.match(picker, /Remove recent custom color/)
  assert.match(picker, /onChange=\{\(event\) => chooseCustom\(event\.target\.value\)\}/)
  assert.match(css, /\.node-color-recent-list\s*\{[^}]*repeat\(5,/s)
  assert.match(css, /\.node-color-remove\s*\{[^}]*position:\s*absolute/s)
})
