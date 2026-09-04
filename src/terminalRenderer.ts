type Disposable = { dispose(): void }
type ContextLossAddon = Disposable & { onContextLoss?: (listener: () => void) => Disposable }
type TerminalAddonHost = { loadAddon(addon: ContextLossAddon): void }
type Logger = { warn(message: string, error?: unknown): void; info?(message: string): void }

let warnedWebglFallback = false
const maxWebglRecreationAttempts = 3
const lostContextFallbackMessage = 'MuxMap: WebGL terminal renderer lost context; falling back to the default renderer.'

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
  let generation = 0
  let recreationAttempts = 0
  let disposed = false
  let fellBack = false
  const disposeCurrentAddon = () => {
    generation += 1
    contextLoss?.dispose()
    addon?.dispose()
    contextLoss = undefined
    addon = null
  }
  const fallbackAfterContextLoss = (error?: unknown) => {
    if (disposed || fellBack) return
    fellBack = true
    disposeCurrentAddon()
    warnWebglFallbackOnce(logger, lostContextFallbackMessage, error)
  }
  const load = () => {
    const nextAddon = createAddon()
    const nextGeneration = generation + 1
    let nextContextLoss: Disposable | undefined
    nextContextLoss = nextAddon.onContextLoss?.(() => {
      if (disposed || fellBack || nextGeneration !== generation) return
      disposeCurrentAddon()
      if (recreationAttempts >= maxWebglRecreationAttempts) {
        fallbackAfterContextLoss()
        return
      }
      recreationAttempts += 1
      try {
        load()
        logger.info?.(`MuxMap: WebGL terminal renderer recreated after context loss (${recreationAttempts}/${maxWebglRecreationAttempts}).`)
      } catch (error) {
        fallbackAfterContextLoss(error)
      }
    })
    try {
      terminal.loadAddon(nextAddon)
    } catch (error) {
      nextContextLoss?.dispose()
      nextAddon.dispose()
      throw error
    }
    generation = nextGeneration
    addon = nextAddon
    contextLoss = nextContextLoss
  }
  const disposeLoadedAddon = () => {
    if (disposed) return
    disposed = true
    disposeCurrentAddon()
  }
  try {
    load()
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
