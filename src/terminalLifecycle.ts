import type { TerminalStatus } from './model.ts'

export function createTerminalLifecycle(onClose: (status: TerminalStatus) => void) {
  let isDisposed = false
  let isOpened = false
  let hasFailed = false

  return {
    open() {
      if (!isDisposed) isOpened = true
    },
    fail() {
      if (isDisposed) return false
      hasFailed = true
      return true
    },
    close() {
      if (!isDisposed) onClose(hasFailed || !isOpened ? 'stopped' : 'detached')
    },
    dispose() {
      isDisposed = true
    },
    disposed() {
      return isDisposed
    },
  }
}
