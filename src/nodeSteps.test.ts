import assert from 'node:assert/strict'
import test from 'node:test'
import { nodeStepperModel, nodeStepSummary, normalizedNodeSteps } from './nodeSteps.ts'

test('node stepper falls back to initialized done for nodes without rows', () => {
  const steps = nodeStepperModel(undefined)
  assert.deepEqual(steps.map((step) => [step.key, step.status, step.tone]), [
    ['initialized', 'done', 'done'],
    ['ticket_created', 'pending', 'current'],
    ['in_progress', 'pending', 'pending'],
    ['mr_raised', 'pending', 'pending'],
    ['finalized', 'pending', 'pending'],
  ])
})

test('node stepper marks first pending after the last done step as current', () => {
  const steps = nodeStepperModel([
    { key: 'initialized', status: 'done' },
    { key: 'ticket_created', status: 'done', ref: 'DEV-2830', url: 'https://jira.example/browse/DEV-2830' },
    { key: 'in_progress', status: 'done' },
  ])
  assert.equal(steps.find((step) => step.tone === 'current')?.key, 'mr_raised')
  assert.deepEqual(nodeStepSummary(steps), {
    dots: '●●●○○',
    label: 'MR raised',
    completed: 3,
    total: 5,
  })
})

test('node step normalization ignores malformed rows', () => {
  assert.deepEqual(normalizedNodeSteps([
    { key: 'initialized', status: 'done' },
    { key: 'unknown', status: 'done' },
    { key: 'finalized', status: 'bad' },
  ]).map((step) => [step.key, step.status]), [
    ['initialized', 'done'],
    ['ticket_created', 'pending'],
    ['in_progress', 'pending'],
    ['mr_raised', 'pending'],
    ['finalized', 'pending'],
  ])
})
