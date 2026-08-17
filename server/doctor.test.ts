import assert from 'node:assert/strict'
import test from 'node:test'
import { runDoctor, subnetCidr, windowsFirewallScript } from './doctor.ts'

const interfaces = [
  { address: '192.168.50.123', family: 'IPv4', internal: false, netmask: '255.255.255.0' },
  { address: '100.101.102.103', family: 'IPv4', internal: false, netmask: '255.255.255.255' },
]

test('doctor validates the default local access mode', async () => {
  const result = await runDoctor({}, {
    platform: 'linux', interfaces, portAvailable: async () => true,
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
  })

  assert.equal(result.ok, true)
  assert.match(result.lines.join('\n'), /Mode: local.*127\.0\.0\.1:4782/s)
})

test('doctor reports explicit password-free network access', async () => {
  const result = await runDoctor({ MUXMAP_ACCESS: 'lan', MUXMAP_AUTH: 'none' }, {
    platform: 'linux', interfaces, portAvailable: async () => true,
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
  })

  assert.equal(result.ok, true)
  assert.match(result.lines.join('\n'), /WARNING.*without password authentication/i)
})

test('Windows LAN doctor generates a subnet-only firewall repair script', async () => {
  let written = ''
  let check = ''
  const result = await runDoctor({ MUXMAP_ACCESS: 'lan', MUXMAP_TOKEN: 'secret' }, {
    platform: 'win32', interfaces, portAvailable: async () => true,
    run: (command, args) => {
      if (command === 'zellij.exe') return { status: 0, stdout: 'zellij 0.44.3', stderr: '' }
      check = args.at(-1) ?? ''
      return { status: 1, stdout: '', stderr: '' }
    },
    writeFile: (_path, contents) => { written = contents },
  })

  assert.equal(result.ok, false)
  assert.match(result.lines.join('\n'), /http:\/\/192\.168\.50\.123:4782/)
  assert.match(written, /-RemoteAddress '192\.168\.50\.0\/24'/)
  assert.match(written, /-Profile Private/)
  assert.match(check, /Profile -ne 'Private'/)
  assert.doesNotMatch(written, /100\.64\.0\.0\/10/)
})

test('Windows Tailscale doctor binds its IP and accepts a matching firewall rule', async () => {
  const result = await runDoctor({ MUXMAP_ACCESS: 'tailscale', MUXMAP_TOKEN: 'secret' }, {
    platform: 'win32', interfaces, portAvailable: async () => true,
    run: (command) => ({
      status: 0,
      stdout: command === 'tailscale' ? '100.101.102.103\r\n' : command === 'zellij.exe' ? 'zellij 0.44.3' : '',
      stderr: '',
    }),
    writeFile: () => { throw new Error('firewall script should not be generated') },
  })

  assert.equal(result.ok, true)
  assert.match(result.lines.join('\n'), /http:\/\/100\.101\.102\.103:4782/)
  assert.match(windowsFirewallScript('tailscale', 4782, ['100.64.0.0/10']), /-RemoteAddress '100\.64\.0\.0\/10'/)
})

test('doctor rejects unauthenticated network access and reports occupied ports', async () => {
  const unauthenticated = await runDoctor({ MUXMAP_ACCESS: 'lan' }, {
    platform: 'linux', interfaces, portAvailable: async () => true,
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
  })
  const occupied = await runDoctor({}, {
    platform: 'linux', interfaces, portAvailable: async () => false,
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
  })

  assert.equal(unauthenticated.ok, false)
  assert.match(unauthenticated.lines.join('\n'), /MUXMAP_TOKEN is required/)
  assert.equal(occupied.ok, false)
  assert.match(occupied.lines.join('\n'), /Port 4782 is already in use/)
})

test('doctor rejects invalid ports before probing the network', async () => {
  const result = await runDoctor({ PORT: '70000' }, {
    platform: 'linux', interfaces,
    portAvailable: async () => { throw new Error('must not probe an invalid port') },
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
  })

  assert.equal(result.ok, false)
  assert.match(result.lines.join('\n'), /PORT must be an integer/)
})

test('doctor reports low open file limits before terminal spawning fails', async () => {
  const low = await runDoctor({}, {
    platform: 'darwin', interfaces, portAvailable: async () => true,
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
    openFileLimit: () => 256,
  })
  const warning = await runDoctor({}, {
    platform: 'darwin', interfaces, portAvailable: async () => true,
    run: () => ({ status: 0, stdout: '', stderr: '' }), writeFile: () => {},
    openFileLimit: () => 768,
  })

  assert.equal(low.ok, true)
  assert.match(low.lines.join('\n'), /WARNING.*Open file limit is 256.*ulimit -n 4096.*posix_spawnp failed/s)
  assert.equal(warning.ok, true)
  assert.match(warning.lines.join('\n'), /WARNING.*Open file limit is 768/s)
})

test('Windows doctor rejects an outdated Zellij', async () => {
  const result = await runDoctor({}, {
    platform: 'win32', interfaces, portAvailable: async () => true,
    run: () => ({ status: 0, stdout: 'zellij 0.43.1', stderr: '' }), writeFile: () => {},
  })

  assert.equal(result.ok, false)
  assert.match(result.lines.join('\n'), /Zellij 0\.44\.3\+/)
})

test('subnet calculation handles non-/24 masks', () => {
  assert.equal(subnetCidr('10.42.9.17', '255.255.252.0'), '10.42.8.0/22')
})
