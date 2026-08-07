import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerminalLifecycle } from './terminalLifecycle.ts'

test('StrictMode cleanup ignores the first socket close and leaves the replacement active', () => {
  const statuses: string[] = []
  const first = createTerminalLifecycle((status) => statuses.push(status))
  first.dispose()
  first.close()

  const replacement = createTerminalLifecycle((status) => statuses.push(status))
  replacement.open()

  assert.deepEqual(statuses, [])
  assert.equal(replacement.disposed(), false)
})

test('a live connection reports detached while a genuine startup failure reports stopped', () => {
  const statuses: string[] = []
  const live = createTerminalLifecycle((status) => statuses.push(status))
  live.open()
  live.close()
  const failed = createTerminalLifecycle((status) => statuses.push(status))
  failed.fail()
  failed.close()
  assert.deepEqual(statuses, ['detached', 'stopped'])
})
