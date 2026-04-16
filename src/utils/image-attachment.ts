/**
 * Fetch first image attachment from a Discord message for Gemini vision.
 */
import type { Attachment, Collection } from 'discord.js'
import { IMAGE_ATTACHMENT_MAX_BYTES } from '../config.ts'

const IMAGE_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function normalizeMime(ct: string | null, filename: string): string | null {
  if (ct?.toLowerCase().startsWith('image/')) {
    return ct.toLowerCase() === 'image/jpg' ? 'image/jpeg' : ct.toLowerCase()
  }
  const lower = filename.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return null
  return IMAGE_EXT[lower.slice(dot)] ?? null
}

export function pickFirstImageAttachment(
  attachments: Collection<string, Attachment>,
): Attachment | null {
  for (const a of attachments.values()) {
    const mime = normalizeMime(a.contentType, a.name)
    if (!mime) continue
    if (a.size > IMAGE_ATTACHMENT_MAX_BYTES) continue
    return a
  }
  return null
}

export async function fetchAttachmentAsBase64(att: Attachment): Promise<{
  mimeType: string
  dataBase64: string
}> {
  const mime = normalizeMime(att.contentType, att.name)
  if (!mime) throw new Error('Not an image attachment')

  const res = await fetch(att.url, {
    headers: { 'User-Agent': 'ND-Discord-Gemini-Bot/1.0' },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

  const cl = res.headers.get('content-length')
  if (cl && parseInt(cl, 10) > IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error('Image too large')
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > IMAGE_ATTACHMENT_MAX_BYTES) throw new Error('Image too large')

  return { mimeType: mime, dataBase64: buf.toString('base64') }
}
