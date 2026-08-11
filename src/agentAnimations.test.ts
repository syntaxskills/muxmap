import assert from 'node:assert/strict'
import test from 'node:test'
import { agentWorkingSweepDelay, agentWorkingSweepPhase, synchronizeAgentWorkingSweeps } from './agentAnimations.ts'

test('working sweep phase and delay are derived from one global clock', () => {
  assert.equal(agentWorkingSweepPhase(0), 0)
  assert.equal(agentWorkingSweepPhase(1650), 0)
  assert.equal(agentWorkingSweepPhase(2475), 825)
  assert.equal(agentWorkingSweepDelay(2475), '-0.825s')
})

test('working sweep synchronization aligns every working node animation', () => {
  const calls: Array<[string, string]> = []
  const sweep = { animationName: 'agent-working-sweep', currentTime: 0 }
  const icon = { animationName: 'agent-working', currentTime: 0 }
  const element = {
    style: { setProperty: (key: string, value: string) => calls.push([key, value]) },
    getAnimations: () => [sweep, icon],
  }
  const root = {
    querySelectorAll: (selector: string) => {
      assert.equal(selector, '.map-node.is-agent-working .node-select')
      return [element, element]
    },
  }

  assert.equal(synchronizeAgentWorkingSweeps(root as unknown as ParentNode, 2475), 2)
  assert.deepEqual(calls, [
    ['--agent-working-sweep-delay', '-0.825s'],
    ['--agent-working-sweep-delay', '-0.825s'],
  ])
  assert.equal(sweep.currentTime, 825)
  assert.equal(icon.currentTime, 0)
})
