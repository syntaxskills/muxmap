export function parseWorkspacePayloadIfChanged<T>(previousText: string | null, nextText: string) {
  if (previousText === nextText) return { changed: false as const }
  return { changed: true as const, graph: JSON.parse(nextText) as T }
}
