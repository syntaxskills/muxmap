import assert from 'node:assert/strict'
import test from 'node:test'
import { accessUrls, parseTailscaleIPv4, requestedAccessMode, requestedAuthMode, resolveNetworkAccess } from './network.ts'

test('local access is the unauthenticated localhost default', () => {
  const access = resolveNetworkAccess(requestedAccessMode({}), undefined)
  assert.deepEqual(access, { mode: 'local', host: '127.0.0.1', requireBasicAuth: false })
  assert.deepEqual(accessUrls(access, 4782), ['http://127.0.0.1:4782'])
})

test('LAN access binds all interfaces and requires authentication', () => {
  assert.throws(() => resolveNetworkAccess('lan'), /MUXMAP_TOKEN/)
  const access = resolveNetworkAccess('lan', 'secret')
  assert.equal(access.host, '0.0.0.0')
  assert.deepEqual(accessUrls(access, 4782, ['192.168.50.123']), ['http://127.0.0.1:4782', 'http://192.168.50.123:4782'])
  assert.equal(requestedAccessMode({ HOST: '0.0.0.0' }), 'lan')
})

test('LAN and Tailscale can explicitly run without a password', () => {
  assert.equal(requestedAuthMode({ MUXMAP_AUTH: 'none' }), 'none')
  assert.deepEqual(resolveNetworkAccess('lan', undefined, undefined, 'none'), {
    mode: 'lan', host: '0.0.0.0', requireBasicAuth: false,
  })
  assert.deepEqual(resolveNetworkAccess('tailscale', undefined, '100.101.102.103', 'none'), {
    mode: 'tailscale', host: '100.101.102.103', requireBasicAuth: false,
  })
  assert.throws(() => resolveNetworkAccess('lan', undefined, undefined, 'invalid'), /MUXMAP_AUTH/)
})

test('Tailscale access binds only its authenticated CGNAT address', () => {
  assert.equal(parseTailscaleIPv4('100.101.102.103\r\n'), '100.101.102.103')
  assert.throws(() => parseTailscaleIPv4('192.168.50.123\n'), /Tailscale IPv4/)
  assert.throws(() => resolveNetworkAccess('tailscale', 'secret', '192.168.50.123'), /Tailscale IPv4/)
  const access = resolveNetworkAccess('tailscale', 'secret', '100.101.102.103')
  assert.deepEqual(access, { mode: 'tailscale', host: '100.101.102.103', requireBasicAuth: true })
  assert.deepEqual(accessUrls(access, 4782), ['http://100.101.102.103:4782'])
})
