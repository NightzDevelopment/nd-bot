/**
 * Moderator Notes System
 * Staff can add private notes on users for future reference
 */

import { readJson, writeJson } from './data-store.ts'

export interface ModNote {
  at: number // timestamp
  by: string // staff member userId
  text: string
  severity?: 'low' | 'medium' | 'high' | undefined // severity level (optional)
}

export interface UserModNotes {
  userId: string
  notes: ModNote[]
  totalCount: number
}

export type ModNotesStore = Record<string, UserModNotes>

const FILE = 'mod-notes.json'
const DEFAULT_STORE: ModNotesStore = {}

async function load(): Promise<ModNotesStore> {
  return readJson<ModNotesStore>(FILE, DEFAULT_STORE)
}

async function save(store: ModNotesStore): Promise<void> {
  await writeJson(FILE, store)
}

/**
 * Add a note to a user
 */
export async function addNote(
  userId: string,
  staffId: string,
  text: string,
  severity?: 'low' | 'medium' | 'high',
): Promise<UserModNotes> {
  const store = await load()
  if (!store[userId]) {
    store[userId] = {
      userId,
      notes: [],
      totalCount: 0,
    }
  }

  store[userId].notes.push({
    at: Date.now(),
    by: staffId,
    text: text.slice(0, 500), // Max 500 chars per note
    severity,
  })
  store[userId].totalCount += 1

  await save(store)
  return store[userId]
}

/**
 * Get notes for a user
 */
export async function getUserNotes(userId: string): Promise<UserModNotes | null> {
  const store = await load()
  return store[userId] ?? null
}

/**
 * Get recent notes for a user
 */
export async function getRecentNotes(userId: string, limit: number = 5): Promise<ModNote[]> {
  const record = await getUserNotes(userId)
  if (!record) return []
  return record.notes.slice(-limit)
}

/**
 * Clear all notes for a user (admin only)
 */
export async function clearNotes(userId: string): Promise<boolean> {
  const store = await load()
  if (store[userId]) {
    delete store[userId]
    await save(store)
    return true
  }
  return false
}

/**
 * Delete a specific note by index
 */
export async function deleteNote(userId: string, noteIndex: number): Promise<boolean> {
  const store = await load()
  if (!store[userId] || !store[userId].notes[noteIndex]) {
    return false
  }

  store[userId].notes.splice(noteIndex, 1)
  store[userId].totalCount = store[userId].notes.length

  await save(store)
  return true
}

/**
 * Get high-severity notes (alerts)
 */
export async function getHighSeverityNotes(userId: string): Promise<ModNote[]> {
  const record = await getUserNotes(userId)
  if (!record) return []
  return record.notes.filter((n) => n.severity === 'high')
}

/**
 * Get users with high-severity notes
 */
export async function getUsersWithHighNotes(): Promise<
  Array<{
    userId: string
    noteCount: number
    highCount: number
    latestNote?: ModNote
  }>
> {
  const store = await load()
  return Object.values(store)
    .filter((r) => r.notes.some((n) => n.severity === 'high'))
    .map((record) => {
      const latestNote = record.notes[record.notes.length - 1]
      return {
        userId: record.userId,
        noteCount: record.notes.length,
        highCount: record.notes.filter((n) => n.severity === 'high').length,
        ...(latestNote ? { latestNote } : {}),
      }
    })
    .sort((a, b) => b.highCount - a.highCount)
}

/**
 * Get formatted notes summary for display
 */
export async function getNotesSummary(userId: string): Promise<string> {
  const record = await getUserNotes(userId)
  if (!record || record.notes.length === 0) {
    return 'No notes'
  }

  const lines: string[] = [`**${record.notes.length} note(s)**`]
  const recent = record.notes.slice(-3)
  for (const note of recent) {
    const date = new Date(note.at).toLocaleDateString()
    const severity = note.severity ? ` [${note.severity.toUpperCase()}]` : ''
    lines.push(
      `• ${note.text.slice(0, 80)}${note.text.length > 80 ? '...' : ''}${severity} (${date})`,
    )
  }

  if (record.notes.length > 3) {
    lines.push(`• ... and ${record.notes.length - 3} more`)
  }

  return lines.join('\n')
}

/**
 * Get all notes (for staff audit)
 */
export async function getAllNotes(): Promise<ModNotesStore> {
  return load()
}
