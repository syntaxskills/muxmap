import { api } from './api.ts'

export type UploadedImageAttachment = {
  url: string
  markdown: string
}

export type UploadedFileAttachment = {
  url: string
  path: string
  name: string
  type: string
  size: number
}

export async function uploadFileAttachment(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Files must be 20 MB or smaller')
  return api<UploadedFileAttachment>(`/api/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
}

export function imageFileFromClipboard(data: Pick<DataTransfer, 'items' | 'files'>) {
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return Array.from(data.files ?? []).find((file) => file.type.startsWith('image/'))
}

export function insertMarkdownAtSelection(value: string, markdown: string, start: number, end: number) {
  const before = value.slice(0, start)
  const after = value.slice(end)
  const prefix = before && !before.endsWith('\n') ? '\n' : ''
  const suffix = after && !after.startsWith('\n') ? '\n' : ''
  const inserted = `${prefix}${markdown}${suffix}`
  const nextValue = `${before}${inserted}${after}`
  return { value: nextValue, cursor: before.length + inserted.length }
}

export function imageAttachmentsInNote(note: string | undefined) {
  if (!note) return []
  const images: Array<{ alt: string; url: string }> = []
  const pattern = /!\[([^\]]*)]\((\/api\/attachments\/[a-f0-9-]+\.(?:gif|jpg|png|webp))\)/gi
  for (const match of note.matchAll(pattern)) {
    images.push({ alt: match[1] || 'Pasted image', url: match[2] })
  }
  return images
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read pasted image')))
    reader.readAsDataURL(file)
  })
}

export async function uploadImageAttachment(file: File) {
  const dataUrl = await fileToDataUrl(file)
  return api<UploadedImageAttachment>('/api/attachments', {
    method: 'POST',
    body: JSON.stringify({ type: file.type, dataUrl }),
  })
}
