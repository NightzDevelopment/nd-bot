import { ChannelType, type Client, type Message, PermissionFlagsBits } from 'discord.js'
import { autoDeleteRulesJson } from '../config.ts'
import { markBotMessageDelete } from '../utils/bot-delete-attribution.ts'
import { isFeatureEnabled } from './feature-gates.ts'

type AutoDeleteRule = {
  name?: string
  channelId?: string
  channelIds?: string[]
  categoryId?: string
  delaySec?: number
  links?: boolean
  invites?: boolean
  attachments?: boolean
  bots?: boolean
  contains?: string[]
  regex?: string[]
  maxLength?: number
}

function parseRules(): AutoDeleteRule[] {
  if (!autoDeleteRulesJson) return []
  try {
    const raw = JSON.parse(autoDeleteRulesJson) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is AutoDeleteRule => !!x && typeof x === 'object')
  } catch {
    console.warn('[auto-delete] invalid AUTO_DELETE_RULES_JSON')
    return []
  }
}

function channelAllowed(rule: AutoDeleteRule, msg: Message): boolean {
  if (!msg.guild || msg.channel.type === ChannelType.DM) return false
  const ids = new Set<string>([
    ...(rule.channelIds ?? []),
    ...(rule.channelId ? [rule.channelId] : []),
  ])
  if (ids.size > 0 && !ids.has(msg.channel.id)) return false
  if (rule.categoryId) {
    const parentId = msg.channel.isThread()
      ? msg.channel.parentId
      : 'parentId' in msg.channel
        ? msg.channel.parentId
        : null
    if (parentId !== rule.categoryId) return false
  }
  return true
}

function messageMatches(rule: AutoDeleteRule, msg: Message): boolean {
  const text = msg.content ?? ''
  if (rule.bots && msg.author.bot) return true
  if (rule.attachments && msg.attachments.size > 0) return true
  if (rule.links && /https?:\/\/|www\./i.test(text)) return true
  if (rule.invites && /(discord\.gg|discord\.com\/invite)\//i.test(text)) return true
  if (rule.maxLength && text.length > rule.maxLength) return true
  for (const needle of rule.contains ?? []) {
    if (needle && text.toLowerCase().includes(needle.toLowerCase())) return true
  }
  for (const pattern of rule.regex ?? []) {
    try {
      if (new RegExp(pattern, 'i').test(text)) return true
    } catch {
      console.warn('[auto-delete] invalid regex in rule:', rule.name ?? '(unnamed)', pattern)
    }
  }
  return false
}

async function deleteLater(msg: Message, rule: AutoDeleteRule): Promise<void> {
  const delay = Math.max(0, Number(rule.delaySec) || 0) * 1000
  setTimeout(() => {
    void (async () => {
      if (!msg.guild?.members.me?.permissions.has(PermissionFlagsBits.ManageMessages)) return
      markBotMessageDelete({
        guildId: msg.guild.id,
        channelId: msg.channel.id,
        messageId: msg.id,
        actor: 'ND Bot · Auto-Delete',
        reason: rule.name ? `Rule: ${rule.name}` : 'Configured auto-delete rule',
      })
      await msg.delete().catch((e) => {
        console.warn('[auto-delete] delete failed:', msg.id, e)
      })
    })()
  }, delay).unref?.()
}

export function registerAutoDelete(client: Client): void {
  if (!isFeatureEnabled('auto_delete')) return
  const rules = parseRules()
  if (rules.length === 0) {
    console.info('[auto-delete] enabled but no AUTO_DELETE_RULES_JSON rules were loaded')
    return
  }
  client.on('messageCreate', async (msg) => {
    for (const rule of rules) {
      if (!channelAllowed(rule, msg)) continue
      if (!messageMatches(rule, msg)) continue
      await deleteLater(msg, rule)
      return
    }
  })
  console.info(`[auto-delete] loaded ${rules.length} rule(s)`)
}
