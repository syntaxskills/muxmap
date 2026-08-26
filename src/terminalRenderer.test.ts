import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAddonWithFallback, resetTerminalRendererWarningForTest } from './terminalRenderer.ts'

test('terminal renderer fallback catches addon activation failures', () => {
  resetTerminalRendererWarningForTest()
  const warnings: string[] = []
  const result = loadAddonWithFallback(
    { loadAddon() { throw new Error('webgl unavailable') } },
    () => ({ dispose() {} }),
    { warn(message) { warnings.push(message) } },
  )
  assert.equal(result, null)
  assert.deepEqual(warnings, ['MuxMap: WebGL terminal renderer unavailable; using the default renderer.'])
})

test('terminal renderer fallback disposes WebGL addon on context loss and logs once', () => {
  resetTerminalRendererWarningForTest()
  let contextLossListener: (() => void) | undefined
  let disposed = 0
  const warnings: string[] = []
  const result = loadAddonWithFallback(
    { loadAddon() {} },
    () => ({
      dispose() { disposed += 1 },
      onContextLoss(listener) {
        contextLossListener = listener
        return { dispose() { disposed += 1 } }
      },
    }),
    { warn(message) { warnings.push(message) } },
  )

  assert.notEqual(result, null)
  contextLossListener?.()
  contextLossListener?.()
  assert.equal(disposed, 2)
  assert.deepEqual(warnings, ['MuxMap: WebGL terminal renderer lost context; falling back to the default renderer.'])
})
