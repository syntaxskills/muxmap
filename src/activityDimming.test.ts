import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('inactive terminal node dimming is wired to settings and visible session activity', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

  assert.match(app, /import \{ activityStaleness, formatActivityAge, sessionActivityTimestamp \} from '\.\/activityTime\.ts'/)
  assert.match(app, /const visibleSessionActivityTimestamps = useMemo/)
  assert.match(app, /return nodeSession && !visibleAgent \? sessionActivityTimestamp\(nodeSession\) : undefined/)
  assert.match(app, /const activityFade = nodeSession && !visibleAgent \? activityStaleness\(/)
  assert.match(app, /enabled:\s*settings\['mindmap\.dimInactiveNodes'\]/)
  assert.match(app, /inactiveAfterHours:\s*settings\['mindmap\.inactiveAfterHours'\]/)
  assert.match(app, /oldestPercent:\s*settings\['mindmap\.inactiveOldestPercent'\]/)
  assert.match(app, /is-activity-\$\{activityFade\}/)

  assert.match(css, /\.map-node\.is-activity-aging:not\(\.is-selected\):not\(\.is-terminal-active\):not\(:hover\):not\(:focus-within\)\s*\{[^}]*opacity:\s*\.72/s)
  assert.match(css, /\.map-node\.is-activity-stale:not\(\.is-selected\):not\(\.is-terminal-active\):not\(:hover\):not\(:focus-within\)\s*\{[^}]*opacity:\s*\.52/s)
  assert.match(css, /\.map-node\s*\{[^}]*filter 150ms ease/s)
})
