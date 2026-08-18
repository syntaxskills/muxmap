type Point = { x: number; y: number }
type TerminalSelectionEvent = { readonly button: number; readonly altKey: boolean; readonly shiftKey: boolean }
export type TerminalWheelMode = 'auto' | 'muxmap' | 'application'
export type RecentTerminalInput = { data: string; at: number }
export type TerminalScrollMultipliers = { precision: number; discrete: number }

export function terminalShortcutData(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'altKey'>) {
  if (event.metaKey && (event.key === 'Backspace' || event.key === 'Delete')) return '\x15'
  if (event.metaKey && event.key === 'ArrowLeft') return '\x01'
  if (event.metaKey && event.key === 'ArrowRight') return '\x05'
  if (event.altKey && event.key === 'ArrowLeft') return '\x1bb'
  if (event.altKey && event.key === 'ArrowRight') return '\x1bf'
  return null
}

export function shouldCopyTerminalSelection(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  hasSelection: boolean,
) {
  return hasSelection && event.key.toLowerCase() === 'c' && (event.metaKey || (event.ctrlKey && event.shiftKey))
}

export function consumeTerminalWheel(
  remainder: number,
  deltaY: number,
  deltaMode: number,
  rows: number,
  cellHeight: number,
  multipliers: TerminalScrollMultipliers = { precision: 4, discrete: 3 },
) {
  const unit = Math.max(1, cellHeight)
  const adjusted = deltaMode === 0
    ? deltaY * multipliers.precision
    : deltaMode === 1
      ? deltaY * unit * multipliers.discrete
      : deltaY * rows * unit
  const total = remainder + adjusted
  const rawLines = Math.trunc(total / unit)
  const lines = Math.max(-200, Math.min(200, rawLines))
  return { lines, remainder: lines === rawLines ? total - lines * unit : 0 }
}

export function terminalWheelHandledByApplication(applicationInteractive: boolean, mode: TerminalWheelMode) {
  if (mode === 'application') return true
  if (mode === 'muxmap') return false
  return applicationInteractive
}

export function forceTerminalTextSelection(event: TerminalSelectionEvent, mouseTracking: boolean) {
  if (!mouseTracking || event.button !== 0) return false
  Object.defineProperties(event, { altKey: { value: true }, shiftKey: { value: true } })
  return true
}

export function shouldDropDuplicateTerminalInput(data: string, previous: RecentTerminalInput | undefined, now: number, enabled: boolean) {
  return enabled && data.length >= 8 && Boolean(previous) && previous!.data === data && now - previous!.at <= 1500
}

export function stopSessionIntent(confirming: boolean) {
  return confirming ? 'stop' : 'confirm'
}

export function drainTerminalOutputBuffer(queue: string[], maxChars: number) {
  let remaining = Math.max(0, maxChars)
  let output = ''
  while (queue.length > 0 && remaining > 0) {
    const chunk = queue[0]
    if (chunk.length <= remaining) {
      output += chunk
      remaining -= chunk.length
      queue.shift()
    } else {
      output += chunk.slice(0, remaining)
      queue[0] = chunk.slice(remaining)
      remaining = 0
    }
  }
  return output
}

export function dragOffset(origin: Point, start: Point, current: Point): Point {
  return { x: origin.x + current.x - start.x, y: origin.y + current.y - start.y }
}

export function normalizeTerminalOpacity(value: unknown) {
  if (value === null || value === '') return 96
  const opacity = Number(value)
  return Number.isFinite(opacity) ? Math.min(100, Math.max(45, opacity)) : 96
}

export function normalizeTerminalSplit(value: unknown) {
  if (value === null || value === '') return 50
  const split = Number(value)
  return Number.isFinite(split) ? Math.round(Math.min(75, Math.max(25, split))) : 50
}
