/**
 * Streaming live alerts: announce when watched Twitch channels go live and when
 * watched YouTube channels upload. Twitch uses the Helix API (needs a client
 * id/secret); YouTube uses the public RSS feed (no API key). Announcements are
 * de-duped via a persisted seen-set.
 *
 * TikTok is intentionally not implemented (no clean first-party API).
 */
import { type Client, EmbedBuilder, type TextChannel } from 'discord.js'
import {
  streamAnnounceChannelId,
  streamingAlertsEnabled,
  streamPollIntervalSec,
  twitchClientId,
  twitchClientSecret,
  twitchWatchLogins,
  youtubeWatchChannels,
} from '../config.ts'
import { childLogger } from '../lib/logger.ts'
import { readJson, writeJson } from './data-store.ts'

const log = childLogger('stream-alerts')

const FILE = 'stream-alerts.json'
type Store = { liveTwitch: string[]; seenYouTube: string[] }
let cache: Store | null = null

async function load(): Promise<Store> {
  if (cache) return cache
  const data = await readJson<Store>(FILE, { liveTwitch: [], seenYouTube: [] })
  if (!Array.isArray(data.liveTwitch)) data.liveTwitch = []
  if (!Array.isArray(data.seenYouTube)) data.seenYouTube = []
  cache = data
  return data
}

async function save(data: Store): Promise<void> {
  cache = data
  await writeJson(FILE, data)
}

async function announceChannel(client: Client): Promise<TextChannel | null> {
  if (!streamAnnounceChannelId) return null
  const ch = await client.channels.fetch(streamAnnounceChannelId).catch(() => null)
  return ch?.isTextBased() && 'send' in ch ? (ch as TextChannel) : null
}

// ── Twitch ───────────────────────────────────────────────────────────────────

let twitchToken: { token: string; expiresAt: number } | null = null

async function getTwitchToken(): Promise<string | null> {
  if (!twitchClientId || !twitchClientSecret) return null
  if (twitchToken && twitchToken.expiresAt > Date.now() + 60_000) return twitchToken.token
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: twitchClientId,
        client_secret: twitchClientSecret,
        grant_type: 'client_credentials',
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { access_token: string; expires_in: number }
    twitchToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    return twitchToken.token
  } catch (e) {
    log.warn({ err: e }, 'twitch token fetch failed')
    return null
  }
}

async function pollTwitch(client: Client): Promise<void> {
  if (twitchWatchLogins.length === 0) return
  const token = await getTwitchToken()
  if (!token || !twitchClientId) return
  try {
    const qs = twitchWatchLogins.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')
    const res = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, {
      headers: { 'Client-Id': twitchClientId, Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as {
      data: { id: string; user_name: string; user_login: string; title: string; game_name: string; thumbnail_url: string }[]
    }
    const liveNow = new Set(data.data.map((s) => s.user_login.toLowerCase()))
    const store = await load()
    const announceCh = await announceChannel(client)

    for (const s of data.data) {
      const login = s.user_login.toLowerCase()
      if (store.liveTwitch.includes(login)) continue // already announced this live session
      store.liveTwitch.push(login)
      if (announceCh) {
        const thumb = s.thumbnail_url.replace('{width}', '640').replace('{height}', '360')
        const embed = new EmbedBuilder()
          .setColor(0x9146ff)
          .setTitle(`${s.user_name} is live on Twitch`)
          .setURL(`https://twitch.tv/${s.user_login}`)
          .setDescription(s.title?.slice(0, 1000) || '')
          .addFields({ name: 'Playing', value: s.game_name || 'Unknown', inline: true })
          .setImage(thumb)
        await announceCh.send({ content: `https://twitch.tv/${s.user_login}`, embeds: [embed] }).catch(() => {})
      }
    }
    // Clear sessions that went offline so the next go-live re-announces.
    store.liveTwitch = store.liveTwitch.filter((l) => liveNow.has(l))
    await save(store)
  } catch (e) {
    log.warn({ err: e }, 'twitch poll failed')
  }
}

// ── YouTube (RSS, keyless) ─────────────────────────────────────────────────────

async function pollYouTube(client: Client): Promise<void> {
  if (youtubeWatchChannels.length === 0) return
  const store = await load()
  const announceCh = await announceChannel(client)
  for (const channelId of youtubeWatchChannels) {
    try {
      const res = await fetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
      )
      if (!res.ok) continue
      const xml = await res.text()
      // First <entry> is the newest upload.
      const idMatch = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)
      const titleMatch = xml.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/)
      const authorMatch = xml.match(/<author>\s*<name>([^<]+)<\/name>/)
      const videoId = idMatch?.[1]
      if (!videoId) continue
      if (store.seenYouTube.includes(videoId)) continue
      store.seenYouTube.push(videoId)
      if (store.seenYouTube.length > 1000) store.seenYouTube = store.seenYouTube.slice(-1000)
      if (announceCh) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle(`${authorMatch?.[1] ?? 'A channel'} uploaded a new video`)
          .setURL(`https://youtu.be/${videoId}`)
          .setDescription(titleMatch?.[1]?.slice(0, 1000) ?? '')
        await announceCh
          .send({ content: `https://youtu.be/${videoId}`, embeds: [embed] })
          .catch(() => {})
      }
    } catch (e) {
      log.warn({ err: e, channelId }, 'youtube poll failed')
    }
  }
  await save(store)
}

export function startStreamingAlertsLoop(client: Client): void {
  if (!streamingAlertsEnabled) return
  if (twitchWatchLogins.length === 0 && youtubeWatchChannels.length === 0) {
    log.info('streaming alerts enabled but no Twitch logins or YouTube channels configured')
    return
  }
  const tick = async (): Promise<void> => {
    await pollTwitch(client)
    await pollYouTube(client)
  }
  setInterval(() => void tick(), streamPollIntervalSec * 1000).unref()
  void tick()
}
