import type { TerminalStatus } from './model.ts'

export function createTerminalLifecycle(onClose: (status: TerminalStatus) => void) {
  let isDisposed = false
  let isOpened = false
  let hasFailed = false
  let isReady = false
  let isClosed = false

  return {
    open() {
      if (!isDisposed) isOpened = true
    },
    ready() {
      if (isDisposed || hasFailed || !isOpened) return false
      isReady = true
      return true
    },
    canInput() {
      return isReady && !isDisposed && !hasFailed
    },
    fail() {
      if (isDisposed) return false
      hasFailed = true
      return true
    },
    close() {
      if (isClosed) return
      isClosed = true
      const status = hasFailed || !isOpened ? 'stopped' : 'detached'
      isReady = false
      isOpened = false
      if (!isDisposed) onClose(status)
    },
    dispose() {
      isDisposed = true
    },
    disposed() {
      return isDisposed
    },
  }
}
