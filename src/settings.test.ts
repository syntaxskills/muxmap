import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultSettings,
  loadSettings,
  parseSettingsJson,
  settingDefinitions,
  settingsJson,
  terminalBackendsForPlatform,
} from './settings.ts'

test('the settings schema exposes exactly twenty adjustable settings', () => {
  assert.equal(settingDefinitions.length, 20)
  assert.equal(new Set(settingDefinitions.map((item) => item.key)).size, 20)
  assert.deepEqual([...new Set(settingDefinitions.map((item) => item.category))], [
    'Appearance',
    'Canvas',
    'Mindmap',
    'Terminal',
    'Notifications',
  ])
})

test('settings JSON accepts partial overrides and round trips all effective values', () => {
  const parsed = parseSettingsJson(JSON.stringify({
    'terminal.opacity': 82,
    'mindmap.expandOnHover': false,
  }), 'linux')

  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.settings?.['terminal.opacity'], 82)
  assert.equal(parsed.settings?.['mindmap.expandOnHover'], false)
  assert.equal(parsed.settings?.['canvas.showGrid'], true)
  assert.deepEqual(parseSettingsJson(settingsJson(parsed.settings!), 'linux').settings, parsed.settings)
})

test('settings JSON reports unknown, mistyped, and out-of-range values', () => {
  const parsed = parseSettingsJson(JSON.stringify({
    'terminal.opacity': 120,
    'canvas.showGrid': 'yes',
    'made.up': true,
  }), 'linux')

  assert.equal(parsed.settings, undefined)
  assert.match(parsed.errors.join('\n'), /terminal\.opacity.*45.*100/i)
  assert.match(parsed.errors.join('\n'), /canvas\.showGrid.*boolean/i)
  assert.match(parsed.errors.join('\n'), /made\.up.*unknown/i)
})

test('terminal backend choices and defaults follow the host platform', () => {
  assert.deepEqual(terminalBackendsForPlatform('win32'), ['zellij'])
  assert.deepEqual(terminalBackendsForPlatform('darwin'), ['tmux', 'zellij'])
  assert.equal(defaultSettings('win32')['terminal.backend'], 'zellij')
  assert.equal(defaultSettings('linux')['terminal.backend'], 'tmux')

  const windowsTmux = parseSettingsJson('{"terminal.backend":"tmux"}', 'win32')
  assert.equal(windowsTmux.settings, undefined)
  assert.match(windowsTmux.errors.join('\n'), /tmux.*Windows/i)

  const migrated = loadSettings('{"terminal.backend":"tmux","terminal.opacity":81}', 'win32')
  assert.equal(migrated['terminal.backend'], 'zellij')
  assert.equal(migrated['terminal.opacity'], 81)
})
