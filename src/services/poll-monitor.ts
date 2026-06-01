/**
 * Native Discord polls: staff vote log + one “final hour” reminder with @here/@everyone.
 */
import {
  ChannelType,
  type Client,
  Events,
  type PartialPollAnswer,
  type PollAnswer,
} from 'discord.js'
import {
  pollLogVotes,
  pollMonitorEnabled,
  pollReminderChannelIds,
  pollReminderHoursBefore,
  pollReminderPingMode,
  pollStaffLogChannelId,
  STAFF_LOG_CHANNEL_ID,
} from '../config.ts'
import { ndEmbed } from '../utils/embed.ts'
import { readJson, writeJson } from './data-store.ts'

const TRACKS_FILE = 'poll-tracks.json'

type PollTrack = {
  messageId: string
  channelId: string
  guildId: string
  expiresAt: number
  lastHourReminderSent: boolean
}

type TrackStore = { tracks: PollTrack[] }

function pollLogId(): string | undefined {
  return pollStaffLogChannelId || STAFF_LOG_CHANNEL_ID
}

/** Rotating lines — light, on-brand chaos. */
function funnyReminderLine(): string {
  const lines = [
    '**Poll o’clock:** the timer is sweating. Cast your vote before it ghosts you.',
    '**Last call (literally):** this poll is almost out of juice — tap an answer like your RP depends on it.',
    '**Hurry mode:** democracy waits for nobody. Except maybe you. For like… an hour.',
    '**Pro tip:** the poll is shy and closing soon — vote now or forever hold your hot takes.',
    '**Emergency broadcast:** the vibes are still open, but not for long. Get your pick in.',
    '**Speedrun voting:** clock’s loud, options are waiting, your opinion is the main character.',
    '**Plot twist:** time is almost up. Choose wisely — or chaotically. We don’t judge.',
    '**Friendly panic:** poll ending soon™ — slide your vote in before it’s lore.',
    '**Reality check:** this isn’t a drill (it kind of is). Vote while the pixels still count.',
    '**Main quest:** pick an option. **Side quest:** do it before the poll yeets itself.',
    '**Attention citizens:** the ballot box is about to nap. Wake it up with your vote.',
    '**Soft deadline, hard FOMO:** last hour energy — don’t let “I’ll vote later” win.',
    '**Server lore moment:** your vote matters. The poll’s closing. Drama optional, participation mandatory.',
    '**Beep boop:** human required. Select an answer before the poll enters witness protection.',
    '**One hour-ish left:** enough time to overthink, not enough to procrastinate forever.',
    '**Poll status:** spicy. **Time status:** rude. **Your status:** should be “voted”.',
    '**Quick maths:** more votes = clearer results. Less votes = more chaos. Choose your fighter.',
    '**This is not a test** (except it is). Vote now; regret later if you must.',
    '**Final stretch:** stretch your fingers, click a choice, ride into the sunset of democracy.',
    '**Breaking:** local poll reportedly “almost done.” Citizens urged to stop scrolling and start voting.',
    '**Your voice. Your vote. Our spreadsheet.** Don’t leave us hanging in the last hour.',
    '**Yes, you:** the poll needs closure. And so does everyone refreshing the channel.',
    '**Low battery warning:** poll closing soon. Plug in your opinion.',
    '**Speed limit:** 1 vote per rules. Emotional damage from missing the deadline: unlimited.',
    '**Achievement unlocked:** “Participated.” (Only if you vote. We can’t unlock vibes for lurkers.)',
    '**Poll fairy says:** last hour wishes are valid — but you still have to click.',
    '**Timeline check:** still time, not much. Vote like you mean it.',
    '**Friendly fire (none):** just vote. The poll is ending, not your career.',
    '**Meta moment:** you read this far — reward yourself by voting. Icon behavior.',
    '**Closing credits incoming:** cast now or explain yourself in #regrets (not a real channel… yet).',
    '**Rubber duck debugging but for democracy:** talk it out, then vote anyway.',
    '**Hype train last stop:** all aboard the “I actually voted” express. Choo choo, time’s up soon.',
    '**Poll:** “Am I ending soon?” **Answer:** yes. **Your move:** obvious.',
    '**One hour warning:** the universe, the mods, and this bot agree — vote or vibe check fails.',
    '**Serious mode (briefly):** your vote helps the team decide. Last moments — make it count.',
  ]
  return lines[Math.floor(Math.random() * lines.length)]!
}

async function loadTracks(): Promise<PollTrack[]> {
  const data = await readJson<TrackStore>(TRACKS_FILE, { tracks: [] })
  return data.tracks ?? []
}

async function saveTracks(tracks: PollTrack[]): Promise<void> {
  await writeJson(TRACKS_FILE, { tracks })
}

async function upsertTrack(t: PollTrack): Promise<void> {
  const cur = await loadTracks()
  const next = cur.filter((x) => x.messageId !== t.messageId)
  next.push(t)
  await saveTracks(next)
}

async function sendLastHourReminder(client: Client, t: PollTrack): Promise<void> {
  const ch = await client.channels.fetch(t.channelId).catch(() => null)
  if (!ch?.isTextBased() || ch.isDMBased()) return
  if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement) return

  const ping = pollReminderPingMode === 'everyone' ? '@everyone' : '@here'
  const url = `https://discord.com/channels/${t.guildId}/${t.channelId}/${t.messageId}`
  const body = `${ping}\n\n${funnyReminderLine()}\n\n**Vote:** ${url}`

  await ch.send({ content: body.slice(0, 2000) }).catch((e) => {
    console.warn('[poll] last-hour reminder failed:', e)
  })
}

async function tickReminders(client: Client): Promise<void> {
  if (!pollMonitorEnabled || pollReminderChannelIds.size === 0) return

  const tracks = await loadTracks()
  const now = Date.now()
  const windowMs = pollReminderHoursBefore * 3600 * 1000
  let changed = false
  const kept: PollTrack[] = []

  for (const t of tracks) {
    if (t.expiresAt <= now) {
      changed = true
      continue
    }
    const remaining = t.expiresAt - now
    if (!t.lastHourReminderSent && remaining <= windowMs && remaining > 0) {
      await sendLastHourReminder(client, t)
      kept.push({ ...t, lastHourReminderSent: true })
      changed = true
    } else {
      kept.push(t)
    }
  }

  if (changed) await saveTracks(kept)
}

async function logVoteToStaff(
  client: Client,
  pollAnswer: PollAnswer | PartialPollAnswer,
  userId: string,
  kind: 'add' | 'remove',
): Promise<void> {
  const logId = pollLogId()
  if (!logId || !pollLogVotes) return

  let poll = pollAnswer.poll
  if (poll.partial) {
    const full = await poll.fetch().catch(() => null)
    if (full) poll = full
  }

  const channelId = poll.channelId
  if (!channelId || !pollReminderChannelIds.has(channelId)) return

  let msg = poll.message
  if (msg.partial) {
    const m = await msg.fetch().catch(() => null)
    if (!m) return
    msg = m
  }

  const question = msg.poll?.question?.text?.slice(0, 500) ?? '*(poll)*'
  const answerLabel = pollAnswer.text?.slice(0, 500) ?? `Answer #${pollAnswer.id}`
  const url = msg.url

  const logCh = await client.channels.fetch(logId).catch(() => null)
  if (!logCh?.isTextBased() || logCh.isDMBased()) return

  const title = kind === 'add' ? 'Poll · vote cast' : 'Poll · vote removed'
  const embed = ndEmbed()
    .setTitle(title)
    .setDescription(`[Open poll](${url})`)
    .addFields(
      { name: 'Question', value: question.slice(0, 1024), inline: false },
      {
        name: 'Answer',
        value: answerLabel.slice(0, 1024),
        inline: true,
      },
      { name: 'User', value: `<@${userId}> \`${userId}\``, inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
    )

  await logCh.send({ embeds: [embed] }).catch((e) => {
    console.warn('[poll] staff log failed:', e)
  })
}

export function registerPollMonitor(client: Client): void {
  if (!pollMonitorEnabled || pollReminderChannelIds.size === 0) {
    console.log(
      '[poll] Monitor off — set POLL_MONITOR_ENABLED=1 and POLL_REMINDER_CHANNEL_IDS (your #polls / #votes channel ID)',
    )
    return
  }

  if (!pollLogId() && pollLogVotes) {
    console.warn(
      '[poll] POLL_LOG_VOTES is on but no staff log — set STAFF_LOG_CHANNEL_ID or POLL_STAFF_LOG_CHANNEL_ID',
    )
  }

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.guild || message.author.bot) return
      if (!message.poll) return
      if (!pollReminderChannelIds.has(message.channel.id)) return
      const exp = message.poll.expiresTimestamp
      if (!exp) return
      await upsertTrack({
        messageId: message.id,
        channelId: message.channel.id,
        guildId: message.guild.id,
        expiresAt: exp,
        lastHourReminderSent: false,
      })
    } catch (e) {
      console.warn('[poll] MessageCreate track failed:', e)
    }
  })

  client.on(Events.MessagePollVoteAdd, (pollAnswer, userId) => {
    void logVoteToStaff(client, pollAnswer, userId, 'add')
  })
  client.on(Events.MessagePollVoteRemove, (pollAnswer, userId) => {
    void logVoteToStaff(client, pollAnswer, userId, 'remove')
  })

  setInterval(() => void tickReminders(client), 45_000).unref()
  void tickReminders(client)

  console.log(
    `[poll] Monitoring ${pollReminderChannelIds.size} polls channel(s); reminders ~${pollReminderHoursBefore}h before close; ping=${pollReminderPingMode}`,
  )
}
