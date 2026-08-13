import assert from 'node:assert/strict'
import test from 'node:test'
import { imageAttachmentsInNote, imageFileFromClipboard, insertMarkdownAtSelection } from './imageAttachments.ts'

test('clipboard image detection prefers pasted image files', () => {
  const image = { type: 'image/png' }
  const text = { type: 'text/plain' }
  const clipboard = {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => text },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ],
    files: [],
  }

  assert.equal(imageFileFromClipboard(clipboard as never), image)
})

test('markdown image insertion preserves surrounding text and cursor position', () => {
  assert.deepEqual(
    insertMarkdownAtSelection('before after', '![pasted image](/api/attachments/1.png)', 7, 7),
    {
      value: 'before \n![pasted image](/api/attachments/1.png)\nafter',
      cursor: 48,
    },
  )
})

test('note image preview extracts only local attachment images', () => {
  assert.deepEqual(
    imageAttachmentsInNote('![one](/api/attachments/abc-123.png)\n![remote](https://example.com/a.png)\n![two](/api/attachments/def.webp)'),
    [
      { alt: 'one', url: '/api/attachments/abc-123.png' },
      { alt: 'two', url: '/api/attachments/def.webp' },
    ],
  )
})
