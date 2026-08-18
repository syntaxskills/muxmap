import type { TerminalBackend } from './model.ts'

export type RuntimePlatform = 'win32' | 'darwin' | 'linux' | string
export const SETTINGS_VERSION = 3
export type SettingCategory = 'Appearance' | 'Canvas' | 'Mindmap' | 'Terminal' | 'Notifications'

export type AppSettings = {
  'workbench.density': 'compact' | 'comfortable'
  'workbench.reduceMotion': boolean
  'canvas.showGrid': boolean
  'canvas.zoomSensitivity': number
  'canvas.panSensitivity': number
  'canvas.autoFitOnLoad': boolean
  'canvas.showLegend': boolean
  'mindmap.columnGap': number
  'mindmap.rowGap': number
  'mindmap.expandOnHover': boolean
  'mindmap.showNodeType': boolean
  'mindmap.dimInactiveNodes': boolean
  'mindmap.inactiveAfterHours': number
  'mindmap.inactiveOldestPercent': number
  'terminal.backend': TerminalBackend
  'terminal.opacity': number
  'terminal.fontSize': number
  'terminal.cursorBlink': boolean
  'terminal.scrollback': number
  'terminal.splitPercent': number
  'terminal.defaultPlacement': 'docked' | 'floating'
  'terminal.wheelMode': 'auto' | 'muxmap' | 'application'
  'terminal.precisionScrollMultiplier': number
  'terminal.discreteScrollMultiplier': number
  'terminal.dedupeRepeatedInput': boolean
  'notifications.delivery': 'both' | 'system' | 'in-page' | 'off'
  'notifications.completed': boolean
  'notifications.needsInput': boolean
}

export type SettingKey = keyof AppSettings

type SettingOption = { value: string; label: string }

export type SettingDefinition = {
  key: SettingKey
  category: SettingCategory
  label: string
  description: string
  control: 'boolean' | 'number' | 'select'
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: SettingOption[]
}

export const settingDefinitions: SettingDefinition[] = [
  { key: 'workbench.density', category: 'Appearance', label: 'Interface density', description: 'Controls spacing in settings and side panels.', control: 'select', options: [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }] },
  { key: 'workbench.reduceMotion', category: 'Appearance', label: 'Reduce motion', description: 'Removes expansion and terminal window animations.', control: 'boolean' },
  { key: 'canvas.showGrid', category: 'Canvas', label: 'Show grid', description: 'Displays the dot grid behind the mindmap.', control: 'boolean' },
  { key: 'canvas.zoomSensitivity', category: 'Canvas', label: 'Zoom sensitivity', description: 'Changes the speed of trackpad pinch zoom.', control: 'number', min: 0.002, max: 0.03, step: 0.002 },
  { key: 'canvas.panSensitivity', category: 'Canvas', label: 'Pan sensitivity', description: 'Changes two-finger canvas movement.', control: 'number', min: 0.25, max: 2, step: 0.05, unit: '×' },
  { key: 'canvas.autoFitOnLoad', category: 'Canvas', label: 'Fit on load', description: 'Centers and fits the graph after opening a workspace.', control: 'boolean' },
  { key: 'canvas.showLegend', category: 'Canvas', label: 'Show shortcuts', description: 'Shows the compact shortcut legend below the canvas.', control: 'boolean' },
  { key: 'mindmap.columnGap', category: 'Mindmap', label: 'Column gap', description: 'Horizontal distance between tree levels.', control: 'number', min: 180, max: 360, step: 10, unit: 'px' },
  { key: 'mindmap.rowGap', category: 'Mindmap', label: 'Row gap', description: 'Vertical distance between sibling branches.', control: 'number', min: 12, max: 64, step: 2, unit: 'px' },
  { key: 'mindmap.expandOnHover', category: 'Mindmap', label: 'Expand on hover', description: 'Reveals node metadata while the pointer rests on it.', control: 'boolean' },
  { key: 'mindmap.showNodeType', category: 'Mindmap', label: 'Show node type', description: 'Keeps the node type visible in its compact state.', control: 'boolean' },
  { key: 'mindmap.dimInactiveNodes', category: 'Mindmap', label: 'Dim inactive nodes', description: 'Softly fades old terminal nodes so current work stays prominent.', control: 'boolean' },
  { key: 'mindmap.inactiveAfterHours', category: 'Mindmap', label: 'Inactive after', description: 'Minimum quiet time before a terminal node can be dimmed.', control: 'number', min: 1, max: 720, step: 1, unit: 'h' },
  { key: 'mindmap.inactiveOldestPercent', category: 'Mindmap', label: 'Inactive cohort', description: 'Only this oldest percentage of visible terminal nodes can be dimmed.', control: 'number', min: 10, max: 90, step: 5, unit: '%' },
  { key: 'terminal.backend', category: 'Terminal', label: 'Default backend', description: 'Used when attaching a new terminal session.', control: 'select', options: [{ value: 'tmux', label: 'tmux' }, { value: 'zellij', label: 'Zellij' }] },
  { key: 'terminal.opacity', category: 'Terminal', label: 'Window opacity', description: 'Applies to docked, floating, and full-screen terminals.', control: 'number', min: 45, max: 100, step: 1, unit: '%' },
  { key: 'terminal.fontSize', category: 'Terminal', label: 'Font size', description: 'Controls terminal text size.', control: 'number', min: 10, max: 20, step: 1, unit: 'px' },
  { key: 'terminal.cursorBlink', category: 'Terminal', label: 'Blinking cursor', description: 'Animates the active terminal cursor.', control: 'boolean' },
  { key: 'terminal.scrollback', category: 'Terminal', label: 'Scrollback', description: 'Maximum terminal history kept in the browser.', control: 'number', min: 1000, max: 50000, step: 1000, unit: 'lines' },
  { key: 'terminal.splitPercent', category: 'Terminal', label: 'Mindmap width', description: 'Share kept for the mindmap when a terminal is docked.', control: 'number', min: 25, max: 75, step: 1, unit: '%' },
  { key: 'terminal.defaultPlacement', category: 'Terminal', label: 'Open terminals', description: 'Chooses the initial terminal window placement.', control: 'select', options: [{ value: 'docked', label: 'Docked right' }, { value: 'floating', label: 'Floating' }] },
  { key: 'terminal.wheelMode', category: 'Terminal', label: 'Wheel routing', description: 'Auto lets Claude Code fullscreen/no-flicker handle its own scrolling, while shell sessions keep MuxMap scrollback.', control: 'select', options: [{ value: 'auto', label: 'Auto' }, { value: 'muxmap', label: 'MuxMap scrollback' }, { value: 'application', label: 'Terminal app' }] },
  { key: 'terminal.precisionScrollMultiplier', category: 'Terminal', label: 'Trackpad scroll speed', description: 'Multiplier for precision pixel scrolling, similar to Ghostty precision scrolling.', control: 'number', min: 0.01, max: 20, step: 0.25, unit: '×' },
  { key: 'terminal.discreteScrollMultiplier', category: 'Terminal', label: 'Wheel scroll speed', description: 'Lines per discrete mouse-wheel tick, similar to Ghostty discrete scrolling.', control: 'number', min: 0.01, max: 20, step: 0.25, unit: '×' },
  { key: 'terminal.dedupeRepeatedInput', category: 'Terminal', label: 'Dedupe repeated input', description: 'Drops repeated long text bursts from dictation or IME glitches before they reach the terminal.', control: 'boolean' },
  { key: 'notifications.delivery', category: 'Notifications', label: 'Delivery', description: 'Choose system notifications, in-page alerts, both, or neither.', control: 'select', options: [{ value: 'both', label: 'System + in-page' }, { value: 'system', label: 'System only' }, { value: 'in-page', label: 'In-page only' }, { value: 'off', label: 'Off' }] },
  { key: 'notifications.completed', category: 'Notifications', label: 'Task completed', description: 'Alerts when an agent finishes.', control: 'boolean' },
  { key: 'notifications.needsInput', category: 'Notifications', label: 'Needs input', description: 'Alerts when an agent asks for help.', control: 'boolean' },
]

export function terminalBackendsForPlatform(platform: RuntimePlatform): TerminalBackend[] {
  return platform === 'win32' ? ['zellij'] : ['tmux', 'zellij']
}

export function platformLabel(platform: RuntimePlatform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

export function defaultSettings(platform: RuntimePlatform): AppSettings {
  return {
    'workbench.density': 'compact',
    'workbench.reduceMotion': false,
    'canvas.showGrid': true,
    'canvas.zoomSensitivity': 0.01,
    'canvas.panSensitivity': 1,
    'canvas.autoFitOnLoad': true,
    'canvas.showLegend': true,
    'mindmap.columnGap': 240,
    'mindmap.rowGap': 30,
    'mindmap.expandOnHover': true,
    'mindmap.showNodeType': false,
    'mindmap.dimInactiveNodes': true,
    'mindmap.inactiveAfterHours': 36,
    'mindmap.inactiveOldestPercent': 50,
    'terminal.backend': platform === 'win32' ? 'zellij' : 'tmux',
    'terminal.opacity': 96,
    'terminal.fontSize': 12,
    'terminal.cursorBlink': true,
    'terminal.scrollback': 10000,
    'terminal.splitPercent': 50,
    'terminal.defaultPlacement': 'docked',
    'terminal.wheelMode': 'auto',
    'terminal.precisionScrollMultiplier': 4,
    'terminal.discreteScrollMultiplier': 3,
    'terminal.dedupeRepeatedInput': true,
    'notifications.delivery': 'both',
    'notifications.completed': true,
    'notifications.needsInput': true,
  }
}

export function notificationDeliveryTargets(delivery: AppSettings['notifications.delivery']) {
  return {
    system: delivery === 'both' || delivery === 'system',
    inPage: delivery === 'both' || delivery === 'in-page',
  }
}

export function isSettingOptionAllowed(key: SettingKey, value: unknown, platform: RuntimePlatform) {
  return key !== 'terminal.backend' || terminalBackendsForPlatform(platform).includes(value as TerminalBackend)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function settingGroup(key: SettingKey) {
  return key.split('.')[0]
}

function nestedSettingName(key: SettingKey) {
  return key.slice(settingGroup(key).length + 1)
}

const settingKeys = new Set<SettingKey>(settingDefinitions.map((item) => item.key))
const settingGroups = new Set(settingDefinitions.map((item) => settingGroup(item.key)))

function assignSetting(values: Partial<Record<SettingKey, unknown>>, errors: string[], key: SettingKey, value: unknown) {
  if (key in values) {
    errors.push(`${key} is defined more than once.`)
    return
  }
  values[key] = value
}

function flattenSettingsObject(input: Record<string, unknown>) {
  const values: Partial<Record<SettingKey, unknown>> = {}
  const errors: string[] = []

  for (const [key, value] of Object.entries(input)) {
    if (settingKeys.has(key as SettingKey)) {
      assignSetting(values, errors, key as SettingKey, value)
      continue
    }
    if (!settingGroups.has(key)) {
      errors.push(`${key} is an unknown setting.`)
      continue
    }
    if (!isRecord(value)) {
      errors.push(`${key} must be an object.`)
      continue
    }
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const flatKey = `${key}.${nestedKey}` as SettingKey
      if (!settingKeys.has(flatKey)) {
        errors.push(`${flatKey} is an unknown setting.`)
        continue
      }
      assignSetting(values, errors, flatKey, nestedValue)
    }
  }

  return { values, errors }
}

export function parseSettingsJson(source: string, platform: RuntimePlatform): { settings?: AppSettings; errors: string[] } {
  let input: unknown
  try {
    input = JSON.parse(source)
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : 'Invalid JSON'] }
  }
  if (!isRecord(input)) return { errors: ['Settings JSON must be an object.'] }

  const flattened = flattenSettingsObject(input)
  const values = flattened.values
  const errors = [...flattened.errors]
  for (const definition of settingDefinitions) {
    if (!(definition.key in values)) continue
    const value = values[definition.key]
    if (definition.control === 'boolean' && typeof value !== 'boolean') errors.push(`${definition.key} must be a boolean.`)
    if (definition.control === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`${definition.key} must be a number.`)
    if (definition.control === 'number' && typeof value === 'number' && (value < definition.min! || value > definition.max!)) errors.push(`${definition.key} must be between ${definition.min} and ${definition.max}.`)
    if (definition.control === 'select' && !definition.options?.some((option) => option.value === value)) errors.push(`${definition.key} has an invalid value.`)
    if (!isSettingOptionAllowed(definition.key, value, platform)) errors.push(`${String(value)} is not available on ${platformLabel(platform)}.`)
  }
  if (errors.length) return { errors }
  return { settings: { ...defaultSettings(platform), ...values } as AppSettings, errors }
}

export function settingsJson(settings: AppSettings) {
  const grouped: Record<string, Record<string, unknown>> = {}
  for (const definition of settingDefinitions) {
    const group = settingGroup(definition.key)
    grouped[group] ??= {}
    grouped[group][nestedSettingName(definition.key)] = settings[definition.key]
  }
  return `${JSON.stringify(grouped, null, 2)}\n`
}

function migrateSettings(settings: AppSettings, sourceVersion: number) {
  if (sourceVersion >= 2) return settings
  return { ...settings, 'mindmap.showNodeType': false }
}

export function loadSettings(source: string | null, platform: RuntimePlatform, sourceVersion = SETTINGS_VERSION) {
  if (!source) return defaultSettings(platform)
  const parsed = parseSettingsJson(source, platform)
  if (parsed.settings) return migrateSettings(parsed.settings, sourceVersion)
  try {
    const input = JSON.parse(source) as unknown
    if (isRecord(input)) {
      const flattened = flattenSettingsObject(input)
      if ('terminal.backend' in flattened.values && !isSettingOptionAllowed('terminal.backend', flattened.values['terminal.backend'], platform)) {
        const migrated = parseSettingsJson(settingsJson({
          ...defaultSettings(platform),
          ...flattened.values,
          'terminal.backend': defaultSettings(platform)['terminal.backend'],
        } as AppSettings), platform).settings
        return migrated ? migrateSettings(migrated, sourceVersion) : defaultSettings(platform)
      }
    }
  } catch {
    // Invalid persisted JSON falls back to platform defaults.
  }
  return defaultSettings(platform)
}
