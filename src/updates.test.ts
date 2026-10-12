import assert from 'node:assert/strict'
import test from 'node:test'
import { checkForUpdates } from './updates.ts'

const commit = 'a'.repeat(40)

test('GitHub comparisons distinguish updates, current builds, and custom builds', async (t) => {
  for (const [githubStatus, expected] of [['ahead', 'available'], ['identical', 'current'], ['behind', 'ahead'], ['diverged', 'diverged']]) {
    const mock = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, options?: RequestInit) => {
      assert.equal(url, `https://api.github.com/repos/syntaxskills/muxmap/compare/${commit}...main?per_page=1`)
      assert.equal(options?.credentials, 'omit')
      assert.equal(options?.cache, 'no-store')
      assert.ok(options?.signal)
      return Response.json({ status: githubStatus })
    })
    const result = await checkForUpdates(commit)
    assert.equal(result.status, expected)
    assert.equal(result.url, `https://github.com/syntaxskills/muxmap/compare/${commit}...main`)
    mock.mock.restore()
  }
})

test('unavailable GitHub checks never claim the build is current and can be retried', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  await assert.rejects(checkForUpdates(null), /no Git commit/)
  await assert.rejects(checkForUpdates('bad/ref'), /no Git commit/)
  assert.equal(mock.mock.callCount(), 0)
  await assert.rejects(checkForUpdates(commit), /Unable to reach GitHub/)
  for (const [status, message] of [[403, /limiting requests/], [429, /limiting requests/], [404, /not available/], [500, /failed \(500\)/]] as const) {
    mock.mock.mockImplementation(async () => new Response('', { status }))
    await assert.rejects(checkForUpdates(commit), message)
  }
  mock.mock.mockImplementation(async () => Response.json({ status: 'unknown' }))
  await assert.rejects(checkForUpdates(commit), /unexpected response/)
  mock.mock.mockImplementation(async () => Response.json({ status: 'identical' }))
  assert.equal((await checkForUpdates(commit)).status, 'current')
})
