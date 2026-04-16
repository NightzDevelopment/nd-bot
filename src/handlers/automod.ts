/**
 * Rule-based AutoMod, runs before AI chat. No Gemini calls.
 */
import { ChannelType, type Message } from 'discord.js'
import {
  automodBlockedAttachmentExtensions,
  automodEnabled,
  automodBlockInvites,
  automodDupeWindowSec,
  automodFastMsgCount,
  automodFastMsgWindowSec,
  automodHomoglyphScriptRatio,
  automodMaxDupes,
  automodMaxLinks,
  automodMaxMentions,
  automodUrlBlocklistRegex,
  urlRiskBlockScore,
  urlRiskDeleteMessage,
  urlRiskEnabled,
} from '../config.ts'
import { isIgnoredChannelOrCategory } from '../utils/channel-ignore.ts'
import { reportAutomod } from '../services/logging.ts'
import { isModMessage } from '../utils/permissions.ts'
import { scoreMessageUrls } from '../utils/url-risk.ts'

const inviteRe = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\//i
const urlRe = /https?:\/\/[^\s]+/gi

// Per-channel user message timestamps for fast-msg
const fastMsg = new Map<string, number[]>()
// Per-user-channel duplicate text (same normalized content)
const dupes = new Map<
  string,
  { count: number; firstAt: number }
>()

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
  const re =
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu
  return (text.match(re) ?? []).length
}

async function notify(
  msg: Message,
  rule: string,
  action: string,
): Promise<void> {
  await reportAutomod(msg, rule, action)
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

  // Dangerous attachment extensions
  for (const a of msg.attachments.values()) {
    const name = a.name.toLowerCase()
    const dot = name.lastIndexOf('.')
    if (dot === -1) continue
    const ext = name.slice(dot + 1)
    if (automodBlockedAttachmentExtensions.includes(ext)) {
      try {
        await msg.delete()
      } catch {}
      await notify(msg, `Blocked attachment extension (.${ext})`, 'Message deleted')
      return 'blocked'
    }
  }

  // Optional URL blocklist (regex)
  const urlBlockRe = automodUrlBlocklistRegex()
  if (urlBlockRe && urlRe.test(content)) {
    const links = content.match(urlRe) ?? []
    for (const link of links) {
      if (urlBlockRe.test(link)) {
        try {
          await msg.delete()
        } catch {}
        await notify(msg, 'URL blocklist match', 'Message deleted')
        try {
          await msg.member.timeout(5 * 60 * 1000, 'AutoMod: blocklist URL')
        } catch {}
        return 'blocked'
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
          await msg.delete()
        } catch {}
        await notify(msg, 'Mixed-script / confusable text', 'Message deleted')
        return 'blocked'
      }
    }
  }

  // Mass mentions
  const mentionCount =
    msg.mentions.users.size + (msg.mentions.everyone ? 50 : 0)
  if (mentionCount >= automodMaxMentions) {
    try {
      await msg.delete()
    } catch {}
    await notify(
      msg,
      `Mass mentions (${mentionCount})`,
      'Message deleted',
    )
    try {
      await msg.member.timeout(
        10 * 60 * 1000,
        'AutoMod: mass mentions',
      )
    } catch {}
    return 'blocked'
  }

  // Invite links
  if (automodBlockInvites && inviteRe.test(content)) {
    try {
      await msg.delete()
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
          await msg.delete()
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
  }

  // Link spam
  const links = content.match(urlRe) ?? []
  if (links.length >= automodMaxLinks) {
    try {
      await msg.delete()
    } catch {}
    await notify(msg, `Link spam (${links.length} links)`, 'Message deleted')
    try {
      await msg.member.timeout(5 * 60 * 1000, 'AutoMod: link spam')
    } catch {}
    return 'blocked'
  }

  // Caps spam
  if (content.length >= 10) {
    const letters = content.replace(/[^a-zA-Z]/g, '')
    if (letters.length >= 10) {
      const caps = letters.replace(/[^A-Z]/g, '').length
      if (caps / letters.length >= 0.7) {
        try {
          await msg.delete()
        } catch {}
        await notify(msg, 'Caps spam', 'Message deleted')
        return 'blocked'
      }
    }
  }

  // Newline spam
  if ((content.match(/\n/g) ?? []).length >= 15) {
    try {
      await msg.delete()
    } catch {}
    await notify(msg, 'Newline spam', 'Message deleted')
    return 'blocked'
  }

  // Zalgo
  if (content.length >= 20 && zalgoScore(content) >= 15) {
    try {
      await msg.delete()
    } catch {}
    await notify(msg, 'Zalgo / combining characters', 'Message deleted')
    return 'blocked'
  }

  // Emoji spam
  if (emojiCount(content) >= 15) {
    try {
      await msg.delete()
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
      await msg.delete()
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
          await msg.delete()
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
