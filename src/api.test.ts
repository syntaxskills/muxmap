import assert from 'node:assert/strict'
import test from 'node:test'
import { readApiResponse } from './api.ts'

test('empty API response reports status instead of a JSON parse error', async () => {
  await assert.rejects(
    readApiResponse(new Response('', { status: 502 })),
    /Request failed with 502/,
  )
})

test('non-JSON API response reports status instead of leaking parser errors', async () => {
  await assert.rejects(
    readApiResponse(new Response('Bad Gateway', { status: 502 })),
    /Request failed with 502/,
  )
})
