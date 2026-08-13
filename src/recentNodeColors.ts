export const recentNodeColorsStorageKey = 'muxmap:recent-node-colors'
export const maxRecentNodeColors = 5

export function normalizeHexColor(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null
}

export function recentNodeColorsFromJson(source: string | null) {
  if (!source) return []
  try {
    const input = JSON.parse(source)
    if (!Array.isArray(input)) return []
    return uniqueRecentNodeColors(input)
  } catch {
    return []
  }
}

export function uniqueRecentNodeColors(values: unknown[]) {
  const seen = new Set<string>()
  const colors: string[] = []
  for (const value of values) {
    const color = normalizeHexColor(value)
    if (!color || seen.has(color)) continue
    seen.add(color)
    colors.push(color)
    if (colors.length >= maxRecentNodeColors) break
  }
  return colors
}

export function rememberRecentNodeColor(current: string[], value: string) {
  const color = normalizeHexColor(value)
  if (!color) return uniqueRecentNodeColors(current)
  return uniqueRecentNodeColors([color, ...current.filter((item) => item !== color)])
}

export function forgetRecentNodeColor(current: string[], value: string) {
  const color = normalizeHexColor(value)
  if (!color) return uniqueRecentNodeColors(current)
  return uniqueRecentNodeColors(current.filter((item) => item !== color))
}
