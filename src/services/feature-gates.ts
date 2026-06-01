import {
  afkEnabled,
  autoDeleteEnabled,
  autoPurgeEnabled,
  levelsEnabled,
  type NightzFeatureTier,
  nightzFeatureTier,
  tiktokNotificationsEnabled,
  twitchNotificationsEnabled,
} from '../config.ts'

export type FeatureKey =
  | 'levels'
  | 'afk'
  | 'auto_delete'
  | 'auto_purge'
  | 'tiktok_notifications'
  | 'twitch_notifications'

const premiumOnly = new Set<FeatureKey>([
  'auto_purge',
  'tiktok_notifications',
  'twitch_notifications',
])

const explicitEnabled: Record<FeatureKey, boolean> = {
  levels: levelsEnabled,
  afk: afkEnabled,
  auto_delete: autoDeleteEnabled,
  auto_purge: autoPurgeEnabled,
  tiktok_notifications: tiktokNotificationsEnabled,
  twitch_notifications: twitchNotificationsEnabled,
}

export function currentFeatureTier(): NightzFeatureTier {
  return nightzFeatureTier
}

export function hasPremiumAccess(): boolean {
  return nightzFeatureTier === 'premium'
}

export function isFeatureEnabled(feature: FeatureKey): boolean {
  if (!explicitEnabled[feature]) return false
  if (premiumOnly.has(feature) && !hasPremiumAccess()) return false
  return true
}

export function describeFeatureGate(feature: FeatureKey): string {
  if (isFeatureEnabled(feature)) return 'enabled'
  if (premiumOnly.has(feature) && !hasPremiumAccess()) {
    return `locked (${nightzFeatureTier} tier)`
  }
  return 'disabled'
}
