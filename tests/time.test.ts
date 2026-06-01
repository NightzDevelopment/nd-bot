import { expect, test } from 'bun:test'
import { formatMs, parseDuration } from '../src/utils/time.ts'

test('parseDuration handles common units', () => {
  expect(parseDuration('30s')).toBe(30_000)
  expect(parseDuration('5m')).toBe(300_000)
  expect(parseDuration('2h')).toBe(7_200_000)
  expect(parseDuration('1d')).toBe(86_400_000)
})

test('parseDuration tolerates whitespace and case', () => {
  expect(parseDuration('  10M ')).toBe(600_000)
})

test('parseDuration rejects bad input', () => {
  expect(parseDuration('')).toBeNull()
  expect(parseDuration('abc')).toBeNull()
  expect(parseDuration('10x')).toBeNull()
  expect(parseDuration('10')).toBeNull()
})

test('formatMs is human readable', () => {
  expect(formatMs(45_000)).toBe('45s')
  expect(formatMs(120_000)).toBe('2m')
})
