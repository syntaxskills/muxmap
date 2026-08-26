type Disposable = { dispose(): void }
type ContextLossAddon = Disposable & { onContextLoss?: (listener: () => void) => Disposable }
type TerminalAddonHost = { loadAddon(addon: ContextLossAddon): void }
type Logger = { warn(message: string, error?: unknown): void }

let warnedWebglFallback = false

function warnWebglFallbackOnce(logger: Logger, message: string, error?: unknown) {
  if (warnedWebglFallback) return
  warnedWebglFallback = true
  logger.warn(message, error)
}

export function resetTerminalRendererWarningForTest() {
  warnedWebglFallback = false
}

export function loadAddonWithFallback(
  terminal: TerminalAddonHost,
  createAddon: () => ContextLossAddon,
  logger: Logger = console,
) {
  let addon: ContextLossAddon | null = null
  let contextLoss: Disposable | undefined
  let disposed = false
  const disposeLoadedAddon = () => {
    if (disposed) return
    disposed = true
    contextLoss?.dispose()
    addon?.dispose()
  }
  try {
    addon = createAddon()
    contextLoss = addon.onContextLoss?.(() => {
      try {
        disposeLoadedAddon()
      } finally {
        warnWebglFallbackOnce(logger, 'MuxMap: WebGL terminal renderer lost context; falling back to the default renderer.')
      }
    })
    terminal.loadAddon(addon)
    return {
      dispose() {
        disposeLoadedAddon()
      },
    }
  } catch (error) {
    disposeLoadedAddon()
    warnWebglFallbackOnce(logger, 'MuxMap: WebGL terminal renderer unavailable; using the default renderer.', error)
    return null
  }
}
