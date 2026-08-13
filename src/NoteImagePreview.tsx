import { imageAttachmentsInNote } from './imageAttachments.ts'

export function NoteImagePreview({ note }: { note?: string }) {
  const images = imageAttachmentsInNote(note)
  if (images.length === 0) return null
  return <div className="note-image-preview" aria-label="Pasted note images">
    {images.map((image) => (
      <a key={image.url} href={image.url} target="_blank" rel="noreferrer">
        <img src={image.url} alt={image.alt} loading="lazy" />
      </a>
    ))}
  </div>
}
