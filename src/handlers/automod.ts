/**
 * Rule-based AutoMod, runs before AI chat. No Gemini calls.
 */
import { ChannelType, type Message } from 'discord.js'
import {
  automodBlockedAttachmentExtensions,
  automodBlockInvites,
  automodDupeWindowSec,
  automodEnabled,
  automodFastMsgCount,
  automodFastMsgWindowSec,
  automodGifUrlBlockHostSuffixes,
  automodHomoglyphScriptRatio,
  automodMaxDupes,
  automodMaxLinks,
  automodMaxMentions,
  automodUrlBlocklistRegex,
  automodUrlBlocklistSubstrings,
  scamLinkAiDelete,
  scamLinkAiEnabled,
  TICKET_CLOSED_CATEGORY_ID,
  TICKET_OPEN_CATEGORY_ID,
  urlHostMatchesAutomodGifBlocklist,
  urlRiskBlockScore,
  urlRiskDeleteMessage,
  urlRiskEnabled,
} from '../config.ts'
import { findLeakDomain } from '../services/leak-domains.ts'
import { reportAutomod } from '../services/logging.ts'
import { quarantineMember } from '../services/profile-scan.ts'
import { markBotMessageDelete } from '../utils/bot-delete-attribution.ts'
import { isIgnoredChannelOrCategory } from '../utils/channel-ignore.ts'
import { isModMessage } from '../utils/permissions.ts'
import { scoreMessageUrls } from '../utils/url-risk.ts'

const inviteRe = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\//i
const urlRe = /https?:\/\/[^\s]+/gi

// Per-channel user message timestamps for fast-msg
const fastMsg = new Map<string, number[]>()
// Per-user-channel duplicate text (same normalized content)
const dupes = new Map<string, { count: number; firstAt: number }>()

// Both maps gain a key per distinct (user, channel) / message and were never
// swept, so over long 24/7 uptime they grew unbounded. Prune stale entries
// periodically (the spam windows are seconds, so a 10-minute TTL is safe).
const SWEEP_EVERY_MS = 5 * 60_000
const ENTRY_TTL_MS = 10 * 60_000
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of dupes) {
    if (now - v.firstAt > ENTRY_TTL_MS) dupes.delete(k)
  }
  for (const [k, stamps] of fastMsg) {
    const newest = stamps.length > 0 ? (stamps[stamps.length - 1] as number) : 0
    if (now - newest > ENTRY_TTL_MS) fastMsg.delete(k)
  }
}, SWEEP_EVERY_MS).unref?.()

function key(userId: string, channelId: string): string {
  return `${userId}:${channelId}`
}

function zalgoScore(text: string): number {
  let n = 0
  for (const c of text) {
    const code = c.codePointAt(0) ?? 0
    if (code >= 0x0300 && code <= 0x036f) n++
    if (code >= 0x1ab0 && code <= 0x1aff) n++
  }
  return n
}

function emojiCount(text: string): number {
  const re = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu
  return (text.match(re) ?? []).length
}

async function notify(msg: Message, rule: string, action: string): Promise<void> {
  await reportAutomod(msg, rule, action)
}

async function deleteAutomodMessage(msg: Message, reason: string): Promise<void> {
  markBotMessageDelete({
    guildId: msg.guild?.id,
    channelId: msg.channel.id,
    messageId: msg.id,
    actor: 'ND Bot · Rule AutoMod',
    reason,
  })
  await msg.delete()
}

function isTicketChannel(msg: Message): boolean {
  if (!('parentId' in msg.channel)) return false
  const parentId = (msg.channel as { parentId?: string | null }).parentId
  return (
    (!!TICKET_OPEN_CATEGORY_ID && parentId === TICKET_OPEN_CATEGORY_ID) ||
    (!!TICKET_CLOSED_CATEGORY_ID && parentId === TICKET_CLOSED_CATEGORY_ID)
  )
}

export async function runRuleAutomod(msg: Message): Promise<'blocked' | 'ok'> {
  if (!automodEnabled) return 'ok'
  if (msg.author.bot) return 'ok'
  if (msg.channel.type === ChannelType.DM) return 'ok'
  if (!msg.guild || !msg.member) return 'ok'
  if (isIgnoredChannelOrCategory(msg.channel)) return 'ok'
  if (isModMessage(msg)) return 'ok'

  const content = msg.content ?? ''
  const now = Date.now()
  const inTicket = isTicketChannel(msg)

  // Dangerous attachment extensions
  for (const a of msg.attachments.values()) {
    const name = a.name.toLowerCase()
    const dot = name.lastIndexOf('.')
    if (dot === -1) continue
    const ext = name.slice(dot + 1)
    if (automodBlockedAttachmentExtensions.includes(ext)) {
      try {
        await deleteAutomodMessage(msg, `Blocked attachment extension (.${ext})`)
      } catch {}
      await notify(msg, `Blocked attachment extension (.${ext})`, 'Message deleted')
      return 'blocked'
    }
  }

  if (!inTicket) {
    // Optional URL blocklist (regex)
    const urlBlockRe = automodUrlBlocklistRegex()
    if (urlBlockRe && urlRe.test(content)) {
      const links = content.match(urlRe) ?? []
      for (const link of links) {
        if (urlBlockRe.test(link)) {
          try {
            await deleteAutomodMessage(msg, 'URL blocklist match')
          } catch {}
          await notify(msg, 'URL blocklist match', 'Message deleted')
          try {
            await msg.member.timeout(5 * 60 * 1000, 'AutoMod: blocklist URL')
          } catch {}
          return 'blocked'
        }
      }
    }

    // Optional URL substring blocklist (comma-separated in env; case-insensitive)
    const urlSubs = automodUrlBlocklistSubstrings()
    if (urlSubs.length > 0 && urlRe.test(content)) {
      const links = content.match(urlRe) ?? []
      for (const link of links) {
        const low = link.toLowerCase()
        for (const sub of urlSubs) {
          if (low.includes(sub.toLowerCase())) {
            try {
              await deleteAutomodMessage(msg, 'URL blocklist substring match')
            } catch {}
            await notify(msg, 'URL blocklist substring match', 'Message deleted')
            try {
              await msg.member.timeout(5 * 60 * 1000, 'AutoMod: blocklist URL')
            } catch {}
            return 'blocked'
          }
        }
      }
    }

    // Known FiveM leak-site domains: delete, quarantine the poster for staff
    // review, and alert staff. Matches de-obfuscated domains (spaces, "dot", [.]).
    const leakDomain = await findLeakDomain(content)
    if (leakDomain) {
      try {
        await deleteAutomodMessage(msg, `Leak site link (${leakDomain})`)
      } catch {}
      await notify(msg, `Leak site link (${leakDomain})`, 'Deleted, member quarantined for staff review')
      const status = await quarantineMember(msg.member, `Leak site link: ${leakDomain}`)
      console.log(`[automod] leak-domain quarantine for ${msg.author.id}: ${status}`)
      return 'blocked'
    }

    // Optional GIF / meme embed host blocklist (AUTOMOD_BLOCK_GIF_URLS + built-in + AUTOMOD_GIF_BLOCK_HOSTS)
    if (automodGifUrlBlockHostSuffixes.length > 0 && urlRe.test(content)) {
      const links = content.match(urlRe) ?? []
      for (const raw of links) {
        let u: URL
        try {
          u = new URL(raw.replace(/[),.;]+$/g, ''))
        } catch {
          continue
        }
        if (urlHostMatchesAutomodGifBlocklist(u.hostname)) {
          try {
            await deleteAutomodMessage(msg, 'GIF / embed link blocked')
          } catch {}
          await notify(msg, 'GIF / embed link blocked', 'Message deleted')
          try {
            await msg.member.timeout(5 * 60 * 1000, 'AutoMod: GIF URL block')
          } catch {}
          return 'blocked'
        }
      }
    }
  }

  // Mixed-script / homoglyph spam (non-Latin ratio)
  if (content.length >= 15) {
    const letters = [...content].filter((c) => /\p{L}/u.test(c))
    if (letters.length >= 12) {
      let nonLatin = 0
      for (const c of letters) {
        if (!/[\u0000-\u024f]/i.test(c)) nonLatin++
      }
      if (nonLatin / letters.length >= automodHomoglyphScriptRatio) {
        try {
          await deleteAutomodMessage(msg, 'Mixed-script / confusable text')
        } catch {}
        await notify(msg, 'Mixed-script / confusable text', 'Message deleted')
        return 'blocked'
      }
    }
  }

  // Mass mentions
  const mentionCount = msg.mentions.users.size + (msg.mentions.everyone ? 50 : 0)
  if (mentionCount >= automodMaxMentions) {
    try {
      await deleteAutomodMessage(msg, `Mass mentions (${mentionCount})`)
    } catch {}
    await notify(msg, `Mass mentions (${mentionCount})`, 'Message deleted')
    try {
      await msg.member.timeout(10 * 60 * 1000, 'AutoMod: mass mentions')
    } catch {}
    return 'blocked'
  }

  if (!inTicket) {
    // Invite links
    if (automodBlockInvites && inviteRe.test(content)) {
      try {
        await deleteAutomodMessage(msg, 'Invite link blocked')
      } catch {}
      await notify(msg, 'Invite link blocked', 'Message deleted')
      return 'blocked'
    }

    // URL / domain risk (typosquats, IP hosts, punycode, etc.)
    if (urlRiskEnabled && urlRe.test(content)) {
      const { score, reasons } = scoreMessageUrls(content)
      if (score >= urlRiskBlockScore && reasons.length > 0) {
        const rule = `URL risk (score ${score}): ${reasons.slice(0, 4).join('; ')}`
        if (urlRiskDeleteMessage) {
          try {
            await deleteAutomodMessage(msg, rule)
          } catch {}
          await notify(msg, rule, 'Message deleted + timeout')
          try {
            await msg.member.timeout(5 * 60 * 1000, 'AutoMod: suspicious URL')
          } catch {}
        } else {
          await notify(msg, rule, 'Logged only (URL_RISK_DELETE_MESSAGE=0)')
        }
        return urlRiskDeleteMessage ? 'blocked' : 'ok'
      }

      // Unknown link that passed the heuristics: ask the AI if it is a scam/phishing site.
      if (scamLinkAiEnabled) {
        const verdict = await import('../services/scam-link-ai.ts')
          .then(({ classifyMessageLinks }) => classifyMessageLinks(content))
          .catch(() => null)
        if (verdict) {
          const rule =
            `AI scam link (${Math.round(verdict.confidence * 100)}%): ${verdict.reason || verdict.url}`.slice(
              0,
              240,
            )
          if (scamLinkAiDelete) {
            try {
              await deleteAutomodMessage(msg, rule)
            } catch {}
            await notify(msg, rule, 'Message deleted')
            try {
              await msg.member?.timeout(5 * 60 * 1000, 'AutoMod: AI-flagged scam link')
            } catch {}
            return 'blocked'
          }
          await notify(msg, rule, 'Logged only (SCAM_LINK_AI_DELETE=0)')
        }
      }
    }

    // Link spam
    const links = content.match(urlRe) ?? []
    if (links.length >= automodMaxLinks) {
      try {
        await deleteAutomodMessage(msg, `Link spam (${links.length} links)`)
      } catch {}
      await notify(msg, `Link spam (${links.length} links)`, 'Message deleted')
      try {
        await msg.member.timeout(5 * 60 * 1000, 'AutoMod: link spam')
      } catch {}
      return 'blocked'
    }
  }

  // Caps spam
  if (content.length >= 10) {
    const letters = content.replace(/[^a-zA-Z]/g, '')
    if (letters.length >= 10) {
      const caps = letters.replace(/[^A-Z]/g, '').length
      if (caps / letters.length >= 0.7) {
        try {
          await deleteAutomodMessage(msg, 'Caps spam')
        } catch {}
        await notify(msg, 'Caps spam', 'Message deleted')
        return 'blocked'
      }
    }
  }

  // Newline spam
  if ((content.match(/\n/g) ?? []).length >= 15) {
    try {
      await deleteAutomodMessage(msg, 'Newline spam')
    } catch {}
    await notify(msg, 'Newline spam', 'Message deleted')
    return 'blocked'
  }

  // Zalgo
  if (content.length >= 20 && zalgoScore(content) >= 15) {
    try {
      await deleteAutomodMessage(msg, 'Zalgo / combining characters')
    } catch {}
    await notify(msg, 'Zalgo / combining characters', 'Message deleted')
    return 'blocked'
  }

  // Emoji spam
  if (emojiCount(content) >= 15) {
    try {
      await deleteAutomodMessage(msg, 'Emoji spam')
    } catch {}
    await notify(msg, 'Emoji spam', 'Message deleted')
    return 'blocked'
  }

  // Fast messaging
  const fk = key(msg.author.id, msg.channel.id)
  const windowMs = automodFastMsgWindowSec * 1000
  const cutoff = now - windowMs
  let stamps = fastMsg.get(fk) ?? []
  stamps = stamps.filter((t) => t > cutoff)
  stamps.push(now)
  fastMsg.set(fk, stamps)
  if (stamps.length >= automodFastMsgCount) {
    try {
      await deleteAutomodMessage(
        msg,
        `Fast messaging (${automodFastMsgCount}+ in ${automodFastMsgWindowSec}s)`,
      )
    } catch {}
    await notify(
      msg,
      `Fast messaging (${automodFastMsgCount}+ in ${automodFastMsgWindowSec}s)`,
      'Message deleted + timeout',
    )
    try {
      await msg.member.timeout(5 * 60 * 1000, 'AutoMod: fast messaging')
    } catch {}
    return 'blocked'
  }

  // Duplicate messages
  const norm = content.trim().toLowerCase()
  if (norm.length >= 3) {
    const dk = `${fk}:${norm.slice(0, 200)}`
    const prev = dupes.get(dk)
    const winMs = automodDupeWindowSec * 1000
    if (!prev || now - prev.firstAt > winMs) {
      dupes.set(dk, { count: 1, firstAt: now })
    } else {
      prev.count++
      dupes.set(dk, prev)
      if (prev.count >= automodMaxDupes) {
        try {
          await deleteAutomodMessage(
            msg,
            `Duplicate spam (${prev.count} same messages in ${automodDupeWindowSec}s)`,
          )
        } catch {}
        await notify(
          msg,
          `Duplicate spam (${prev.count} same messages in ${automodDupeWindowSec}s)`,
          'Message deleted + timeout',
        )
        dupes.delete(dk)
        try {
          await msg.member.timeout(5 * 60 * 1000, 'AutoMod: duplicate spam')
        } catch {}
        return 'blocked'
      }
    }
  }

  return 'ok'
}
