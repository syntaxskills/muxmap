import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

test('theme bootstraps before rendering, follows system changes, and honors persisted overrides', () => {
  let stored: string | null = null
  const events: Record<string, (event?: { key: string | null }) => void> = {}
  const root = { dataset: { theme: '' }, style: { colorScheme: '' } }
  const media = { matches: true, addEventListener: (_: string, listener: () => void) => { events.system = listener } }
  runInNewContext(readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8'), {
    matchMedia: () => media,
    document: { documentElement: root, querySelector: () => null },
    localStorage: { getItem: () => stored },
    window: { addEventListener: (name: string, listener: () => void) => { events[name] = listener } },
  })
  assert.equal(root.dataset.theme, 'dark')
  media.matches = false
  events.system()
  assert.equal(root.dataset.theme, 'light')
  for (const source of ['{"workbench.theme":"dark"}', '{"workbench":{"theme":"dark"}}']) {
    stored = source
    events['muxmap:settings-changed']()
    assert.equal(root.dataset.theme, 'dark')
    events.system()
    assert.equal(root.dataset.theme, 'dark')
    assert.equal(root.style.colorScheme, 'dark')
  }
  stored = '{"workbench.theme":"light"}'
  media.matches = true
  events.storage({ key: 'muxmap:settings' })
  assert.equal(root.dataset.theme, 'light')
  for (const source of [null, 'broken json', 'null', '{"workbench.theme":"invalid"}', '{"workbench.theme":"system"}']) {
    stored = source
    events.storage({ key: null })
    assert.equal(root.dataset.theme, 'dark')
  }
})
