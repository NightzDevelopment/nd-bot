/**
 * Audit Alert Poller: periodically checks Discord audit logs for suspicious activity
 * and posts alerts to the configured staff channel.
 */
import { type Client, EmbedBuilder } from 'discord.js'
import { auditAlertChannelId, auditAlertPollMs } from '../config.ts'
import { type AuditAlert, detectAlerts } from './discord-audit.ts'

const ALERT_COLOR: Record<AuditAlert['severity'], number> = {
  high: 0xef4444,
  medium: 0xfbbf24,
}

// Track which alert signatures we've already fired so we don't spam
const _firedKeys = new Set<string>()
const FIRED_TTL_MS = 15 * 60 * 1000
const _firedAt = new Map<string, number>()

function alertKey(a: AuditAlert): string {
  return `${a.type}:${a.executor?.id ?? 'unknown'}:${Math.floor(a.detectedAt / 60_000)}`
}

function pruneOldFired(): void {
  const now = Date.now()
  for (const [k, t] of _firedAt) {
    if (now - t > FIRED_TTL_MS) {
      _firedKeys.delete(k)
      _firedAt.delete(k)
    }
  }
}

async function postAlerts(client: Client, alerts: AuditAlert[]): Promise<void> {
  const channelId = auditAlertChannelId
  if (!channelId) return

  const newAlerts = alerts.filter((a) => {
    const k = alertKey(a)
    if (_firedKeys.has(k)) return false
    _firedKeys.add(k)
    _firedAt.set(k, Date.now())
    return true
  })
  if (!newAlerts.length) return

  try {
    const ch = await client.channels.fetch(channelId)
    if (!ch?.isTextBased() || ch.isDMBased()) return

    for (const alert of newAlerts) {
      const embed = new EmbedBuilder()
        .setColor(ALERT_COLOR[alert.severity])
        .setTitle(`Security Alert: ${alert.severity.toUpperCase()}`)
        .setDescription(`**${alert.message}**`)
        .setTimestamp(new Date(alert.detectedAt))

      if (alert.executor) {
        embed.addFields({
          name: 'Executor',
          value: `${alert.executor.tag} \`${alert.executor.id}\``,
          inline: true,
        })
      }

      embed.addFields({
        name: 'Detected',
        value: `<t:${Math.floor(alert.detectedAt / 1000)}:R>`,
        inline: true,
      })

      embed.setFooter({ text: 'Nightz Network · Audit Alert System' })

      await (ch as any).send({ embeds: [embed] })
    }
  } catch (e) {
    console.warn('[audit-alert] failed to post alert:', e)
  }
}

export function startAuditAlertPoller(client: Client): void {
  if (!auditAlertChannelId) {
    console.log('[audit-alert] AUDIT_ALERT_CHANNEL_ID not set, alerts will only show in dashboard')
    return
  }

  console.log(
    `[audit-alert] Polling every ${Math.round(auditAlertPollMs / 1000)}s, posting to channel ${auditAlertChannelId}`,
  )

  const tick = async (): Promise<void> => {
    try {
      pruneOldFired()
      const alerts = await detectAlerts(client)
      if (alerts.length) await postAlerts(client, alerts)
    } catch (e) {
      console.warn('[audit-alert] poll error:', e)
    }
  }

  // First check after 30s (let guild cache warm up)
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), auditAlertPollMs)
  }, 30_000)
}
