import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultSettings,
  loadSettings,
  notificationDeliveryTargets,
  parseSettingsJson,
  SETTINGS_VERSION,
  settingDefinitions,
  settingsJson,
  terminalBackendsForPlatform,
} from './settings.ts'

test('the settings schema exposes the compact adjustable settings', () => {
  assert.equal(settingDefinitions.length, 26)
  assert.equal(new Set(settingDefinitions.map((item) => item.key)).size, 26)
  assert.deepEqual([...new Set(settingDefinitions.map((item) => item.category))], [
    'Appearance',
    'Canvas',
    'Mindmap',
    'Terminal',
    'Notifications',
  ])
})

test('notification delivery can target the system, the page, both, or neither', () => {
  assert.deepEqual(notificationDeliveryTargets('both'), { system: true, inPage: true })
  assert.deepEqual(notificationDeliveryTargets('system'), { system: true, inPage: false })
  assert.deepEqual(notificationDeliveryTargets('in-page'), { system: false, inPage: true })
  assert.deepEqual(notificationDeliveryTargets('off'), { system: false, inPage: false })
  assert.equal(defaultSettings('linux')['notifications.delivery'], 'both')
  assert.equal(parseSettingsJson('{"notifications.delivery":"system"}', 'linux').settings?.['notifications.delivery'], 'system')
})

test('settings JSON accepts partial overrides and round trips all effective values', () => {
  const parsed = parseSettingsJson(JSON.stringify({
    terminal: { opacity: 82, wheelMode: 'application', dedupeRepeatedInput: false },
    mindmap: { expandOnHover: false },
  }), 'linux')

  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.settings?.['terminal.opacity'], 82)
  assert.equal(parsed.settings?.['terminal.wheelMode'], 'application')
  assert.equal(parsed.settings?.['terminal.dedupeRepeatedInput'], false)
  assert.equal(parsed.settings?.['mindmap.expandOnHover'], false)
  assert.equal(parsed.settings?.['canvas.showGrid'], true)
  assert.deepEqual(parseSettingsJson(settingsJson(parsed.settings!), 'linux').settings, parsed.settings)

  const exported = JSON.parse(settingsJson(parsed.settings!)) as Record<string, Record<string, unknown>>
  assert.equal(exported.terminal.opacity, 82)
  assert.equal(exported.terminal.wheelMode, 'application')
  assert.equal(exported.terminal.dedupeRepeatedInput, false)
  assert.equal(exported.mindmap.expandOnHover, false)
  assert.equal((exported as Record<string, unknown>)['terminal.opacity'], undefined)
})

test('settings JSON still accepts legacy flat settings while writing the nested format', () => {
  const parsed = parseSettingsJson(JSON.stringify({
    'terminal.opacity': 82,
    'mindmap.expandOnHover': false,
  }), 'linux')

  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.settings?.['terminal.opacity'], 82)
  assert.equal(parsed.settings?.['mindmap.expandOnHover'], false)
  assert.equal(JSON.parse(settingsJson(parsed.settings!)).terminal.opacity, 82)
})

test('settings JSON reports unknown, duplicate, mistyped, and out-of-range values', () => {
  const parsed = parseSettingsJson(JSON.stringify({
    terminal: { opacity: 120, madeUp: true },
    canvas: { showGrid: 'yes' },
    'made.up': true,
    mindmap: true,
    'terminal.opacity': 90,
  }), 'linux')

  assert.equal(parsed.settings, undefined)
  assert.match(parsed.errors.join('\n'), /terminal\.opacity.*45.*100/i)
  assert.match(parsed.errors.join('\n'), /terminal\.opacity.*defined more than once/i)
  assert.match(parsed.errors.join('\n'), /canvas\.showGrid.*boolean/i)
  assert.match(parsed.errors.join('\n'), /terminal\.madeUp.*unknown/i)
  assert.match(parsed.errors.join('\n'), /made\.up.*unknown/i)
  assert.match(parsed.errors.join('\n'), /mindmap.*object/i)
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

test('node type is secondary and hidden by default', () => {
  assert.equal(defaultSettings('linux')['mindmap.showNodeType'], false)
  assert.equal(loadSettings('{"mindmap.showNodeType":true}', 'linux', 1)['mindmap.showNodeType'], false)
  assert.equal(loadSettings('{"mindmap.showNodeType":true}', 'linux', SETTINGS_VERSION)['mindmap.showNodeType'], true)
})

test('inactive node dimming is configurable through UI and JSON settings', () => {
  const defaults = defaultSettings('linux')
  assert.equal(defaults['mindmap.dimInactiveNodes'], true)
  assert.equal(defaults['mindmap.inactiveAfterHours'], 36)
  assert.equal(defaults['mindmap.inactiveOldestPercent'], 50)

  const parsed = parseSettingsJson(JSON.stringify({
    mindmap: {
      dimInactiveNodes: false,
      inactiveAfterHours: 72,
      inactiveOldestPercent: 35,
    },
  }), 'linux')
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.settings?.['mindmap.dimInactiveNodes'], false)
  assert.equal(parsed.settings?.['mindmap.inactiveAfterHours'], 72)
  assert.equal(parsed.settings?.['mindmap.inactiveOldestPercent'], 35)

  assert.match(parseSettingsJson('{"mindmap":{"inactiveAfterHours":0}}', 'linux').errors.join('\n'), /inactiveAfterHours.*1.*720/)
  assert.match(parseSettingsJson('{"mindmap":{"inactiveOldestPercent":95}}', 'linux').errors.join('\n'), /inactiveOldestPercent.*10.*90/)
})

test('old flat persisted settings migrate to current nested JSON without losing valid values', () => {
  const migrated = loadSettings(JSON.stringify({
    'workbench.density': 'comfortable',
    'terminal.opacity': 81,
    'mindmap.inactiveAfterHours': 72,
  }), 'linux', SETTINGS_VERSION - 1)

  assert.equal(migrated['workbench.density'], 'comfortable')
  assert.equal(migrated['terminal.opacity'], 81)
  assert.equal(migrated['mindmap.inactiveAfterHours'], 72)
  const exported = JSON.parse(settingsJson(migrated))
  assert.equal(exported.workbench.density, 'comfortable')
  assert.equal(exported.terminal.opacity, 81)
  assert.equal(exported.mindmap.inactiveAfterHours, 72)
})
