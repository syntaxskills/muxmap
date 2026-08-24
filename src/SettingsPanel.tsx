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
import { systemNotificationResultText, type SystemNotificationResult } from './systemNotifications.ts'
import type { NodeStepDefinition } from './model.ts'

type Props = {
  settings: AppSettings
  platform: string
  nodeStepDefinitions: readonly NodeStepDefinition[]
  notificationPermission: NotificationPermission | 'unsupported'
  onChange(settings: AppSettings): void
  onNodeStepDefinitionsChange(steps: NodeStepDefinition[]): Promise<void>
  onEnableNotifications(): void
  onTestSystemNotification(): Promise<SystemNotificationResult>
  onClose(): void
}

const categories: SettingCategory[] = ['Appearance', 'Canvas', 'Mindmap', 'Lifecycle', 'Terminal', 'Notifications']

function settingValue(definition: SettingDefinition, settings: AppSettings) {
  return settings[definition.key]
}

export function SettingsPanel({ settings, platform, nodeStepDefinitions, notificationPermission, onChange, onNodeStepDefinitionsChange, onEnableNotifications, onTestSystemNotification, onClose }: Props) {
  const [mode, setMode] = useState<'ui' | 'json'>('ui')
  const [category, setCategory] = useState<SettingCategory>('Appearance')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(() => settingsJson(settings))
  const [jsonErrors, setJsonErrors] = useState<string[]>([])
  const [stepDrafts, setStepDrafts] = useState<NodeStepDefinition[]>(() => nodeStepDefinitions.map((step) => ({ ...step })))
  const [stepError, setStepError] = useState('')
  const [stepSaved, setStepSaved] = useState(false)
  const [notificationTest, setNotificationTest] = useState<SystemNotificationResult | null>(null)

  useEffect(() => {
    if (mode === 'ui') setDraft(settingsJson(settings))
  }, [mode, settings])

  useEffect(() => {
    setStepDrafts(nodeStepDefinitions.map((step) => ({ ...step })))
    setStepError('')
    setStepSaved(false)
  }, [nodeStepDefinitions])

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

  function updateStep(index: number, patch: Partial<NodeStepDefinition>) {
    setStepSaved(false)
    setStepError('')
    setStepDrafts((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step))
  }

  async function saveSteps() {
    setStepError('')
    setStepSaved(false)
    try {
      await onNodeStepDefinitionsChange(stepDrafts)
      setStepSaved(true)
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'Unable to save lifecycle steps')
    }
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
            {category === 'Lifecycle' && !query && <div className="lifecycle-settings-editor">
              <div className="lifecycle-settings-heading">
                <span><strong>Development stages</strong><small>These keys are exposed to MCP tools. Agents use them when calling muxmap_update_node_step.</small></span>
                <button type="button" onClick={() => setStepDrafts((current) => [...current, { key: `step_${current.length + 1}`, label: `Step ${current.length + 1}` }])} disabled={stepDrafts.length >= 8}>Add step</button>
              </div>
              <div className="lifecycle-step-editor-list">
                {stepDrafts.map((step, index) => (
                  <div className="lifecycle-step-editor-row" key={`${step.key}-${index}`}>
                    <span>{index + 1}</span>
                    <input value={step.key} onChange={(event) => updateStep(index, { key: event.target.value })} aria-label={`Step ${index + 1} key`} placeholder="key" />
                    <input value={step.label} onChange={(event) => updateStep(index, { label: event.target.value })} aria-label={`Step ${index + 1} label`} placeholder="Label" />
                    <input value={step.description ?? ''} onChange={(event) => updateStep(index, { description: event.target.value || undefined })} aria-label={`Step ${index + 1} description`} placeholder="Description" />
                    <button type="button" onClick={() => setStepDrafts((current) => current.filter((_, stepIndex) => stepIndex !== index))} disabled={stepDrafts.length <= 1} aria-label={`Remove ${step.label || step.key}`}>Remove</button>
                  </div>
                ))}
              </div>
              <div className="lifecycle-settings-actions">
                <small>{stepSaved ? 'Saved. MCP tools will use the updated keys.' : stepError || 'Saved on the MuxMap server.'}</small>
                <button type="button" onClick={() => setStepDrafts(nodeStepDefinitions.map((step) => ({ ...step })))}>Revert</button>
                <button className="is-primary" type="button" onClick={() => void saveSteps()}>Save stages</button>
              </div>
            </div>}
            {category === 'Notifications' && !query && <div className="notification-permission">
              <span><strong>System notifications</strong><small>Your browser delivers agent alerts to the operating system notification center.</small>{notificationTest && <small className={`notification-test-result is-${notificationTest}`} role="status">{systemNotificationResultText(notificationTest)}</small>}</span>
              <span className="notification-actions">
                <button type="button" onClick={onEnableNotifications} disabled={notificationPermission !== 'default'}>{notificationPermission === 'granted' ? 'Enabled' : notificationPermission === 'denied' ? 'Blocked' : notificationPermission === 'unsupported' ? 'Unavailable' : 'Enable'}</button>
                <button type="button" onClick={() => void onTestSystemNotification().then(setNotificationTest)} disabled={notificationPermission === 'unsupported'}>Send test</button>
              </span>
            </div>}
          </div>
        </div>
      </> : <div className="settings-json-editor">
        <div className="settings-json-heading"><div><strong>settings.json</strong><small>Nested JSON is saved. Legacy dotted keys are still accepted.</small></div><button type="button" onClick={() => { const next = defaultSettings(platform); onChange(next); setDraft(settingsJson(next)); setJsonErrors([]) }}>Reset</button></div>
        <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setJsonErrors([]) }} spellCheck="false" aria-label="Settings JSON" />
        {jsonErrors.length > 0 && <div className="settings-json-errors" role="alert">{jsonErrors.map((message) => <span key={message}>{message}</span>)}</div>}
        <div className="settings-json-actions"><span>{platformLabel(platform)} platform rules apply</span><button type="button" onClick={() => setDraft(settingsJson(parseSettingsJson(draft, platform).settings ?? settings))}>Format</button><button className="is-primary" type="button" onClick={applyJson}>Apply settings</button></div>
      </div>}
    </aside>
  )
}
