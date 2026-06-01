import { expect, test } from 'bun:test'
import { sanitizeReply } from '../src/services/gemini.ts'

test('replaces em dash with comma', () => {
  expect(sanitizeReply('This is great — really great.')).toBe('This is great, really great.')
})

test('replaces em dash with no surrounding spaces', () => {
  expect(sanitizeReply('Three things—A, B, and C.')).toBe('Three things, A, B, and C.')
})

test('replaces en dash', () => {
  expect(sanitizeReply('ND_Scenes – the manager.')).toBe('ND_Scenes, the manager.')
})

test('preserves regular hyphens in compound words', () => {
  const out = sanitizeReply('Use the drop-in config in ND-DiscordUnified.')
  expect(out).toContain('drop-in')
  expect(out).toContain('ND-DiscordUnified')
})

test('output never contains em or en dashes', () => {
  const samples = [
    'a — b — c',
    'word—word—word',
    'mix – of — dashes',
  ]
  for (const s of samples) {
    expect(/[—–]/.test(sanitizeReply(s))).toBe(false)
  }
})

test('empty input returns empty', () => {
  expect(sanitizeReply('')).toBe('')
})
