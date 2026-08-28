import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const component = readFileSync(new URL('./AgentEventList.tsx', import.meta.url), 'utf8')

test('agent event log is collapsed by default and loads full events only when opened', () => {
  assert.match(component, /const \[open, setOpen\] = useState\(false\)/)
  assert.match(component, /<details className="agent-event-list" open=\{open\} onToggle=\{\(event\) => setOpen\(event\.currentTarget\.open\)\}>/)
  assert.doesNotMatch(component, /<details className="agent-event-list" open>/)
  assert.match(component, /if \(!open\) return/)
  assert.match(component, /\}, \[open, sessionId\]\)/)
})
