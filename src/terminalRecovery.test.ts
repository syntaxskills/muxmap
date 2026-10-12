import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { attachTerminalRecovery } from './terminalRecovery.ts'

function fixture(t: TestContext, readyState = 1) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const window = new EventTarget()
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const navigator = { onLine: true }
  const originals = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries({ window, document, navigator })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  }
  t.after(() => {
    dispose()
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const sent: string[] = []
  const socket = Object.assign(new EventTarget(), { readyState, send: (data: string) => sent.push(data) })
  let disconnected = false
  let reconnects = 0
  const dispose = attachTerminalRecovery(socket as unknown as WebSocket, () => disconnected, () => { reconnects++ })
  return { window, document, navigator, socket, sent, dispose, disconnect: () => { disconnected = true }, reconnects: () => reconnects }
}

for (const readyState of [1, 2, 3]) {
  test(`activation reconnects a disconnected terminal once with socket state ${readyState}`, (t) => {
    const f = fixture(t, readyState)
    if (readyState === 1) f.disconnect()
    f.document.dispatchEvent(new Event('visibilitychange'))
    f.window.dispatchEvent(new Event('focus'))
    f.window.dispatchEvent(new Event('pageshow'))
    assert.equal(f.reconnects(), 1)
    assert.deepEqual(f.sent, [])
    f.dispose()
  })
}

test('healthy sockets are probed without reconnecting and any reply cancels the timeout', (t) => {
  const f = fixture(t)
  f.window.dispatchEvent(new Event('focus'))
  f.document.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(f.sent.map((data) => JSON.parse(data)), [{ type: 'ping' }])
  t.mock.timers.tick(4999)
  assert.equal(f.reconnects(), 0)
  f.socket.dispatchEvent(new Event('message'))
  t.mock.timers.tick(1)
  assert.equal(f.reconnects(), 0)
  f.window.dispatchEvent(new Event('pageshow'))
  t.mock.timers.tick(5000)
  assert.equal(f.reconnects(), 1, 'an unresponsive OPEN socket is replaced')
})

test('a connecting socket gets time to finish but cannot hang forever after activation', (t) => {
  const f = fixture(t, 0)
  f.window.dispatchEvent(new Event('focus'))
  assert.deepEqual(f.sent, [], 'do not send before the socket opens')
  t.mock.timers.tick(4999)
  assert.equal(f.reconnects(), 0)
  t.mock.timers.tick(1)
  assert.equal(f.reconnects(), 1)
})

test('hidden or offline tabs wait for visibility or online recovery', (t) => {
  const f = fixture(t, 3)
  f.document.visibilityState = 'hidden'
  f.window.dispatchEvent(new Event('focus'))
  f.window.dispatchEvent(new Event('online'))
  t.mock.timers.tick(10000)
  assert.equal(f.reconnects(), 0)
  f.document.visibilityState = 'visible'
  f.navigator.onLine = false
  f.document.dispatchEvent(new Event('visibilitychange'))
  assert.equal(f.reconnects(), 0)
  f.navigator.onLine = true
  f.window.dispatchEvent(new Event('online'))
  assert.equal(f.reconnects(), 1)
})

test('hiding cancels a probe and cleanup removes every activation listener and timer', (t) => {
  const f = fixture(t)
  f.window.dispatchEvent(new Event('focus'))
  f.document.visibilityState = 'hidden'
  f.document.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(10000)
  assert.equal(f.reconnects(), 0)
  f.document.visibilityState = 'visible'
  f.window.dispatchEvent(new Event('focus'))
  f.dispose()
  for (const event of ['focus', 'online', 'pageshow']) f.window.dispatchEvent(new Event(event))
  f.document.dispatchEvent(new Event('visibilitychange'))
  t.mock.timers.tick(10000)
  assert.equal(f.reconnects(), 0)
  assert.equal(f.sent.length, 2)
})
