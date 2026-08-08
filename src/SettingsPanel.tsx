import { useEffect, useMemo, useState } from 'react'
import { Cross2Icon, MagnifyingGlassIcon } from '@radix-ui/react-icons'
import {
  defaultSettings,
  isSettingOptionAllowed,
  parseSettingsJson,
  platformLabel,
  settingDefinitions,
  settingsJson,
  type AppSettings,
  type SettingCategory,
  type SettingDefinition,
  type SettingKey,
} from './settings.ts'

type Props = {
  settings: AppSettings
  platform: string
  notificationPermission: NotificationPermission | 'unsupported'
  onChange(settings: AppSettings): void
  onEnableNotifications(): void
  onClose(): void
}

const categories: SettingCategory[] = ['Appearance', 'Canvas', 'Mindmap', 'Terminal', 'Notifications']

function settingValue(definition: SettingDefinition, settings: AppSettings) {
  return settings[definition.key]
}

export function SettingsPanel({ settings, platform, notificationPermission, onChange, onEnableNotifications, onClose }: Props) {
  const [mode, setMode] = useState<'ui' | 'json'>('ui')
  const [category, setCategory] = useState<SettingCategory>('Appearance')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(() => settingsJson(settings))
  const [jsonErrors, setJsonErrors] = useState<string[]>([])

  useEffect(() => {
    if (mode === 'ui') setDraft(settingsJson(settings))
  }, [mode, settings])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return settingDefinitions.filter((item) => (!needle && item.category === category) || (needle && `${item.key} ${item.label} ${item.description}`.toLowerCase().includes(needle)))
  }, [category, query])

  function update(key: SettingKey, value: AppSettings[SettingKey]) {
    onChange({ ...settings, [key]: value })
  }

  function applyJson() {
    const parsed = parseSettingsJson(draft, platform)
    setJsonErrors(parsed.errors)
    if (!parsed.settings) return
    onChange(parsed.settings)
    setDraft(settingsJson(parsed.settings))
  }

  return (
    <aside className="side-panel settings-panel" aria-label="Settings">
      <header className="settings-header">
        <div><span>Preferences</span><h2>Settings</h2></div>
        <button className="side-panel-close" type="button" onClick={onClose} aria-label="Close settings" title="Close panel"><Cross2Icon /></button>
      </header>

      <div className="settings-mode" role="tablist" aria-label="Settings editor mode">
        <button type="button" role="tab" aria-selected={mode === 'ui'} onClick={() => setMode('ui')}>User interface</button>
        <button type="button" role="tab" aria-selected={mode === 'json'} onClick={() => setMode('json')}>JSON</button>
      </div>

      {mode === 'ui' ? <>
        <label className="settings-search"><MagnifyingGlassIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" aria-label="Search settings" /></label>
        <div className="settings-workbench">
          <nav className="settings-categories" aria-label="Setting categories">
            {categories.map((item) => <button key={item} type="button" aria-current={!query && category === item ? 'page' : undefined} onClick={() => { setCategory(item); setQuery('') }}>{item}<span>{settingDefinitions.filter((definition) => definition.category === item).length}</span></button>)}
          </nav>
          <div className="settings-list">
            <div className="settings-list-heading"><div><span>{query ? 'Search results' : category}</span><strong>{visible.length} settings</strong></div><small>{platformLabel(platform)} · saved in this browser</small></div>
            {visible.length === 0 ? <p className="settings-empty">No matching settings.</p> : visible.map((definition) => {
              const value = settingValue(definition, settings)
              return <label className="setting-row" key={definition.key}>
                <span className="setting-copy"><strong>{definition.label}</strong><code>{definition.key}</code><small>{definition.description}</small></span>
                <span className="setting-input">
                  {definition.control === 'boolean' && <input type="checkbox" checked={value as boolean} onChange={(event) => update(definition.key, event.target.checked)} />}
                  {definition.control === 'number' && <span className="setting-number"><input type="number" min={definition.min} max={definition.max} step={definition.step} value={value as number} onChange={(event) => update(definition.key, Math.min(definition.max!, Math.max(definition.min!, Number(event.target.value))))} /><i>{definition.unit}</i></span>}
                  {definition.control === 'select' && <select value={String(value)} onChange={(event) => update(definition.key, event.target.value as AppSettings[SettingKey])}>{definition.options?.map((option) => <option key={option.value} value={option.value} disabled={!isSettingOptionAllowed(definition.key, option.value, platform)}>{option.label}{isSettingOptionAllowed(definition.key, option.value, platform) ? '' : ` · unavailable on ${platformLabel(platform)}`}</option>)}</select>}
                </span>
              </label>
            })}
            {category === 'Notifications' && !query && <div className="notification-permission"><span><strong>Browser permission</strong><small>Required before MuxMap can show agent alerts.</small></span><button type="button" onClick={onEnableNotifications} disabled={notificationPermission !== 'default'}>{notificationPermission === 'granted' ? 'Enabled' : notificationPermission === 'denied' ? 'Blocked by browser' : notificationPermission === 'unsupported' ? 'Unavailable' : 'Enable'}</button></div>}
          </div>
        </div>
      </> : <div className="settings-json-editor">
        <div className="settings-json-heading"><div><strong>settings.json</strong><small>Partial JSON is accepted. Defaults fill omitted keys.</small></div><button type="button" onClick={() => { const next = defaultSettings(platform); onChange(next); setDraft(settingsJson(next)); setJsonErrors([]) }}>Reset</button></div>
        <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setJsonErrors([]) }} spellCheck="false" aria-label="Settings JSON" />
        {jsonErrors.length > 0 && <div className="settings-json-errors" role="alert">{jsonErrors.map((message) => <span key={message}>{message}</span>)}</div>}
        <div className="settings-json-actions"><span>{platformLabel(platform)} platform rules apply</span><button type="button" onClick={() => setDraft(settingsJson(parseSettingsJson(draft, platform).settings ?? settings))}>Format</button><button className="is-primary" type="button" onClick={applyJson}>Apply settings</button></div>
      </div>}
    </aside>
  )
}
