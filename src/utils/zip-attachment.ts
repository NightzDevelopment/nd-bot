import type { Attachment, Collection } from 'discord.js'
import JSZip from 'jszip'
import {
  ZIP_ATTACHMENT_MAX_BYTES,
  ZIP_ATTACHMENT_MAX_FILE_CHARS,
  ZIP_ATTACHMENT_MAX_FILES,
} from '../config.ts'

const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.lua',
  '.sql',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.env',
  '.log',
  '.csv',
  '.ps1',
  '.sh',
  '.bat',
  '.cmd',
])

function isZip(att: Attachment): boolean {
  const ct = att.contentType?.toLowerCase() ?? ''
  const n = att.name.toLowerCase()
  return ct.includes('zip') || n.endsWith('.zip')
}

function isLikelyTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return false
  return TEXT_EXT.has(lower.slice(dot))
}

function cleanSnippet(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
}

async function fetchAttachmentAsBuffer(att: Attachment): Promise<Buffer> {
  const res = await fetch(att.url, {
    headers: { 'User-Agent': 'ND-Discord-Gemini-Bot/1.0' },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

  const cl = res.headers.get('content-length')
  if (cl && parseInt(cl, 10) > ZIP_ATTACHMENT_MAX_BYTES) {
    throw new Error('ZIP too large')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > ZIP_ATTACHMENT_MAX_BYTES) {
    throw new Error('ZIP too large')
  }
  return buf
}

export function pickFirstZipAttachment(
  attachments: Collection<string, Attachment>,
): Attachment | null {
  for (const a of attachments.values()) {
    if (!isZip(a)) continue
    if (a.size > ZIP_ATTACHMENT_MAX_BYTES) continue
    return a
  }
  return null
}

export async function summarizeZipAttachment(att: Attachment): Promise<string> {
  if (!isZip(att)) throw new Error('Not a ZIP attachment')
  const buf = await fetchAttachmentAsBuffer(att)
  const zip = await JSZip.loadAsync(buf)
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  const scanned = entries.slice(0, ZIP_ATTACHMENT_MAX_FILES)

  const lines: string[] = []
  lines.push(
    `ZIP "${att.name}" includes ${entries.length} file(s).`,
    `Scanned up to ${scanned.length} file(s) for readable text.`,
  )

  let shown = 0
  let binaryLike = 0
  let totalChars = lines.join('\n').length

  for (const f of scanned) {
    if (!isLikelyTextFile(f.name)) {
      binaryLike++
      continue
    }
    const raw = await f.async('string').catch(() => '')
    const snippet = cleanSnippet(raw).slice(0, ZIP_ATTACHMENT_MAX_FILE_CHARS)
    if (!snippet) continue

    const line = `- ${f.name}: ${snippet}`
    if (totalChars + line.length + 1 > 3600) break
    lines.push(line)
    totalChars += line.length + 1
    shown++
  }

  if (shown === 0) {
    lines.push('No readable text files were extracted from the scanned entries.')
  }
  if (binaryLike > 0) {
    lines.push(`Skipped ${binaryLike} likely binary/non-text file(s).`)
  }
  if (entries.length > scanned.length) {
    lines.push(`Only the first ${scanned.length} entries were scanned.`)
  }
  return lines.join('\n').slice(0, 3800)
}
