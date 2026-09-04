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

function createTrackedAddon(name: string, log: string[]) {
  let contextLossListener: (() => void) | undefined
  return {
    name,
    addon: {
      dispose() { log.push(`${name}:dispose`) },
      onContextLoss(listener: () => void) {
        contextLossListener = listener
        return { dispose() { log.push(`${name}:context-dispose`) } }
      },
    },
    loseContext() {
      contextLossListener?.()
    },
  }
}

test('terminal renderer recreates WebGL addon after context loss', () => {
  resetTerminalRendererWarningForTest()
  const log: string[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const addons: ReturnType<typeof createTrackedAddon>[] = []
  const loaded: string[] = []
  const result = loadAddonWithFallback(
    { loadAddon(addon) { loaded.push((addon as { name?: string }).name ?? 'addon') } },
    () => {
      const tracked = createTrackedAddon(`addon-${addons.length + 1}`, log)
      addons.push(tracked)
      return Object.assign(tracked.addon, { name: tracked.name })
    },
    { warn(message) { warnings.push(message) }, info(message) { infos.push(message) } },
  )

  assert.notEqual(result, null)
  addons[0].loseContext()
  assert.deepEqual(loaded, ['addon-1', 'addon-2'])
  assert.deepEqual(log, ['addon-1:context-dispose', 'addon-1:dispose'])
  assert.deepEqual(warnings, [])
  assert.deepEqual(infos, ['MuxMap: WebGL terminal renderer recreated after context loss (1/3).'])
})

test('terminal renderer falls back if recreation creation throws', () => {
  resetTerminalRendererWarningForTest()
  const log: string[] = []
  const warnings: string[] = []
  const addons: ReturnType<typeof createTrackedAddon>[] = []
  const result = loadAddonWithFallback(
    { loadAddon() {} },
    () => {
      if (addons.length > 0) throw new Error('recreate failed')
      const tracked = createTrackedAddon('addon-1', log)
      addons.push(tracked)
      return tracked.addon
    },
    { warn(message) { warnings.push(message) } },
  )

  assert.notEqual(result, null)
  addons[0].loseContext()
  assert.deepEqual(log, ['addon-1:context-dispose', 'addon-1:dispose'])
  assert.deepEqual(warnings, ['MuxMap: WebGL terminal renderer lost context; falling back to the default renderer.'])
})

test('terminal renderer caps context-loss recreations at three attempts', () => {
  resetTerminalRendererWarningForTest()
  const log: string[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const addons: ReturnType<typeof createTrackedAddon>[] = []
  const loaded: string[] = []
  const result = loadAddonWithFallback(
    { loadAddon(addon) { loaded.push((addon as { name?: string }).name ?? 'addon') } },
    () => {
      const tracked = createTrackedAddon(`addon-${addons.length + 1}`, log)
      addons.push(tracked)
      return Object.assign(tracked.addon, { name: tracked.name })
    },
    { warn(message) { warnings.push(message) }, info(message) { infos.push(message) } },
  )

  assert.notEqual(result, null)
  addons[0].loseContext()
  addons[1].loseContext()
  addons[2].loseContext()
  assert.deepEqual(loaded, ['addon-1', 'addon-2', 'addon-3', 'addon-4'])
  assert.equal(infos.length, 3)
  assert.deepEqual(warnings, [])

  addons[3].loseContext()
  assert.deepEqual(loaded, ['addon-1', 'addon-2', 'addon-3', 'addon-4'])
  assert.deepEqual(warnings, ['MuxMap: WebGL terminal renderer lost context; falling back to the default renderer.'])
})

test('terminal renderer dispose targets the current recreated addon and disables future recreation', () => {
  resetTerminalRendererWarningForTest()
  const log: string[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const addons: ReturnType<typeof createTrackedAddon>[] = []
  const result = loadAddonWithFallback(
    { loadAddon() {} },
    () => {
      const tracked = createTrackedAddon(`addon-${addons.length + 1}`, log)
      addons.push(tracked)
      return tracked.addon
    },
    { warn(message) { warnings.push(message) }, info(message) { infos.push(message) } },
  )

  assert.notEqual(result, null)
  addons[0].loseContext()
  log.length = 0
  result?.dispose()
  addons[1].loseContext()

  assert.deepEqual(log, ['addon-2:context-dispose', 'addon-2:dispose'])
  assert.deepEqual(warnings, [])
  assert.deepEqual(infos, ['MuxMap: WebGL terminal renderer recreated after context loss (1/3).'])
  assert.equal(addons.length, 2)
})
