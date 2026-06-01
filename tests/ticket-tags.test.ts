import { expect, test } from 'bun:test'
import { normalizeTag } from '../src/services/ticket-store.ts'

test('lowercases and hyphenates spaces', () => {
  expect(normalizeTag('Hello World')).toBe('hello-world')
})

test('trims surrounding whitespace', () => {
  expect(normalizeTag('  ESX  ')).toBe('esx')
})

test('strips disallowed characters', () => {
  expect(normalizeTag('bug!! report?? #1')).toBe('bug-report-1')
})

test('keeps allowed punctuation', () => {
  expect(normalizeTag('config/modules.lua')).toBe('config/modules.lua')
})

test('caps length', () => {
  expect(normalizeTag('a'.repeat(80)).length).toBeLessThanOrEqual(40)
})
