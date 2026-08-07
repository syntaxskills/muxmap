type Point = { x: number; y: number }
const terminalMouseModes = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016])

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

export function isTerminalMouseTracking(params: (number | number[])[]) {
  return params.length > 0 && params.every((param) => typeof param === 'number' && terminalMouseModes.has(param))
}

export function stopSessionIntent(confirming: boolean) {
  return confirming ? 'stop' : 'confirm'
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
