import { expect, test } from 'bun:test'
import { getConfigManifest, isManifestKey } from '../src/dashboard/config-manifest.ts'

function tabOf(key: string): string | undefined {
  return getConfigManifest().find((f) => f.key === key)?.tab
}

test('new feature toggles are present in the manifest', () => {
  for (const k of [
    'APPEALS_ENABLED',
    'MODMAIL_ENABLED',
    'VERIFY_ENABLED',
    'STARBOARD_ENABLED',
    'STREAMING_ALERTS_ENABLED',
    'ALT_DETECTION_ENABLED',
    'RAID_AUTOLOCK_ENABLED',
    'AI_REPLY_DISCLAIMER',
  ]) {
    expect(isManifestKey(k)).toBe(true)
  }
})

test('security features land in the Security tab', () => {
  expect(tabOf('APPEALS_ENABLED')).toBe('Security')
  expect(tabOf('VERIFY_ROLE_ID')).toBe('Security')
  expect(tabOf('ALT_DETECTION_ENABLED')).toBe('Security')
})

test('streaming/starboard land in Community+', () => {
  expect(tabOf('STARBOARD_ENABLED')).toBe('Community+')
  expect(tabOf('TWITCH_CLIENT_ID')).toBe('Community+')
  expect(tabOf('YOUTUBE_WATCH_CHANNELS')).toBe('Community+')
})

test('twitch client secret is marked sensitive', () => {
  const f = getConfigManifest().find((x) => x.key === 'TWITCH_CLIENT_SECRET')
  expect(f?.sensitive).toBe(true)
})
