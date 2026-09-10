import assert from 'node:assert/strict'
import test from 'node:test'
import { checkFileNote } from './fileNoteStatus.ts'

test('clicked file checks distinguish missing files from other errors and recheck restored files', async (t) => {
  const url = '/api/files/open?path=src%2Fmissing.ts&cwd=%2Frepo&sessionId=sess_live'
  let status = 404
  const requests = t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
    assert.equal(input, url)
    assert.equal(options.method, 'HEAD')
    assert.equal(options.cache, 'no-store')
    if (!status) throw new Error('Offline')
    return new Response(null, { status })
  })
  assert.equal(await checkFileNote('https://example.com'), undefined)
  assert.equal(await checkFileNote(), undefined)
  assert.equal(requests.mock.callCount(), 0)
  for (const [code, expected] of [[404, 'File not found'], [200, ''], [400, 'Unable to open file'], [401, 'Unable to open file'], [0, 'Unable to check file']] as const) {
    status = code
    assert.equal(await checkFileNote(url), expected)
  }

  let finishOldRequest!: (response: Response) => void
  requests.mock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishOldRequest = resolve }))
  const oldCheck = checkFileNote(url)
  status = 200
  assert.equal(await checkFileNote(url), '')
  finishOldRequest(new Response(null, { status: 404 }))
  assert.equal(await oldCheck, undefined)
})
