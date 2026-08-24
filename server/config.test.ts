import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadMuxMapConfig, validateNodeStepDefinitions } from './config.ts'

test('MuxMap config loads configurable node lifecycle steps', () => {
  const directory = mkdtempSync(join(tmpdir(), 'muxmap-config-'))
  try {
    const path = join(directory, 'muxmap.config.json')
    writeFileSync(path, JSON.stringify({
      nodeSteps: [
        { key: 'briefed', label: 'Briefed', description: 'Human wrote the brief.' },
        { key: 'patched', label: 'Patched' },
        { key: 'reviewed', label: 'Reviewed' },
      ],
    }))

    const config = loadMuxMapConfig({}, directory)
    assert.equal(config.source, path)
    assert.deepEqual(config.nodeStepDefinitions.map((step) => [step.key, step.label]), [
      ['briefed', 'Briefed'],
      ['patched', 'Patched'],
      ['reviewed', 'Reviewed'],
    ])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('MuxMap config validates node lifecycle step definitions', () => {
  const result = validateNodeStepDefinitions([
    { key: 'ok', label: 'OK' },
    { key: 'ok', label: 'Duplicate' },
    { key: 'bad key', label: 'Bad' },
    { key: 'toolong', label: 'x'.repeat(41) },
    { key: 'extra', label: 'Extra', color: 'red' },
  ])

  assert.equal(result.definitions, undefined)
  assert.match(result.errors.join('\n'), /duplicates ok/)
  assert.match(result.errors.join('\n'), /1-64/)
  assert.match(result.errors.join('\n'), /1-40/)
  assert.match(result.errors.join('\n'), /unknown fields/)
})
