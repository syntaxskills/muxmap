import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('agent hook carries MUXMAP_TOKEN as Basic Auth', { timeout: 5000 }, async () => {
  let authorization: string | undefined
  let payload: Record<string, unknown> | undefined
  const server = createServer()
  const received = new Promise<void>((resolve) => {
    server.once('request', (request, response) => {
      authorization = request.headers.authorization
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        payload = JSON.parse(body)
        response.writeHead(202).end()
        resolve()
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./agent-hook.mjs', import.meta.url)), 'codex'], {
      env: { ...process.env, TMUX_PANE: '%1', MUXMAP_TOKEN: 'persistent-token', MUXMAP_URL: `http://127.0.0.1:${address.port}` },
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.stdin.end('{"hook_event_name":"Stop","session_id":"019fd54a-12a9-72c2-8a66-ee62fc1c546e"}')
    await received
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    assert.equal(authorization, `Basic ${Buffer.from('muxmap:persistent-token').toString('base64')}`)
    const event = payload?.event as { muxmap?: { session_id?: string; cwd?: string } }
    assert.equal(event.muxmap?.session_id, '019fd54a-12a9-72c2-8a66-ee62fc1c546e')
    assert.ok(event.muxmap?.cwd)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
