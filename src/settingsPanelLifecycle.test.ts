import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const panel = readFileSync(new URL('./SettingsPanel.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

test('settings exposes editable server lifecycle stages', () => {
  assert.match(panel, /const categories:[^=]+=\s*\[[^\]]*'Lifecycle'/s)
  assert.match(panel, /Development stages/)
  assert.match(panel, /onNodeStepDefinitionsChange\(stepDrafts\)/)
  assert.match(app, /api<\{\s*steps:\s*NodeStepDefinition\[\]\s*\}>\('\/api\/node-step-definitions'/)
})

test('lifecycle UI can be disabled without removing stored step data', () => {
  assert.match(app, /settings\['lifecycle\.enabled'\]/)
  assert.match(app, /\{stepSummary && <span className="is-wide node-step-summary"/)
  assert.match(app, /\{lifecycleEnabled && <NodeStepPopover steps=\{stepper\} \/>/)
})
