import { useSyncExternalStore } from 'react'

const statuses = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useFileNoteStatus(url?: string) {
  return useSyncExternalStore(subscribe, () => url ? statuses.get(url) : undefined)
}

export async function checkFileNote(url?: string) {
  if (!url?.startsWith('/api/files/open?')) return
  const request = fetch(url, { method: 'HEAD', cache: 'no-store' })
    .then((response) => response.ok ? '' : response.status === 404 ? 'File not found' : 'Unable to open file')
    .catch(() => 'Unable to check file')
  pending.set(url, request)
  const status = await request
  if (pending.get(url) !== request) return
  pending.delete(url)
  if (status) statuses.set(url, status)
  else statuses.delete(url)
  for (const listener of listeners) listener()
  return status
}
