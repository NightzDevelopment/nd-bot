/**
 * Voice TTS: join VC, synthesize AI replies via Google Cloud TTS, play through Discord voice.
 */
import {
  type Client,
  type VoiceBasedChannel,
  Events,
} from 'discord.js'
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  StreamType,
  type AudioPlayer,
  type VoiceConnection,
} from '@discordjs/voice'
import { Readable } from 'node:stream'
import {
  getVoiceSttReplyChannelId,
  voiceAutoJoinChannelId,
  voiceAutoLeaveSeconds,
  voiceSttEnabled,
  voiceTtsEnabled,
  voiceTtsLanguage,
  voiceTtsMaxChars,
  voiceTtsPitch,
  voiceTtsSpeakingRate,
  voiceTtsVoiceName,
} from '../config.ts'
import { attachVoiceSpeechToText } from './voice-stt.ts'

let ttsClient: any = null

async function getTtsClient(): Promise<any> {
  if (ttsClient) return ttsClient
  const mod = await import('@google-cloud/text-to-speech')
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()
  const apiKey = process.env.GOOGLE_TTS_API_KEY?.trim()
  // Prefer service account JSON (ADC); else API key; else default client (ADC / metadata).
  if (credsPath) {
    ttsClient = new mod.TextToSpeechClient()
  } else if (apiKey) {
    ttsClient = new mod.TextToSpeechClient({ apiKey })
  } else {
    ttsClient = new mod.TextToSpeechClient()
  }
  return ttsClient
}

type QueueItem = { text: string; guildId: string }
const queues = new Map<string, QueueItem[]>()
const players = new Map<string, AudioPlayer>()
const emptyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function getOrCreatePlayer(guildId: string): AudioPlayer {
  let p = players.get(guildId)
  if (p) return p
  p = createAudioPlayer()
  players.set(guildId, p)
  return p
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const client = await getTtsClient()
  const request: any = {
    input: { text: text.slice(0, voiceTtsMaxChars) },
    voice: {
      languageCode: voiceTtsLanguage,
      ...(voiceTtsVoiceName ? { name: voiceTtsVoiceName } : {}),
    },
    audioConfig: {
      audioEncoding: 'OGG_OPUS',
      speakingRate: voiceTtsSpeakingRate,
      pitch: voiceTtsPitch,
    },
  }
  const [response] = await client.synthesizeSpeech(request)
  return Buffer.from(response.audioContent as Uint8Array)
}

export function isInVoice(guildId: string): boolean {
  return !!getVoiceConnection(guildId)
}

export async function joinChannel(
  channel: VoiceBasedChannel,
  client?: Client,
): Promise<VoiceConnection> {
  const guildId = channel.guild.id
  cancelEmptyTimer(guildId)

  const existing = getVoiceConnection(guildId)
  if (existing) {
    if (existing.joinConfig.channelId === channel.id) return existing
    existing.destroy()
  }

  const conn = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  })

  try {
    await entersState(conn, VoiceConnectionStatus.Ready, 20_000)
  } catch {
    conn.destroy()
    throw new Error('Could not connect to voice channel within 20 seconds.')
  }

  const player = getOrCreatePlayer(guildId)
  conn.subscribe(player)
  if (voiceSttEnabled && client && getVoiceSttReplyChannelId()) {
    attachVoiceSpeechToText(conn, client, channel.id)
  }
  console.log(`[voice] joined ${channel.name} (${channel.id})`)
  return conn
}

export function leaveVoice(guildId: string): void {
  cancelEmptyTimer(guildId)
  const conn = getVoiceConnection(guildId)
  if (conn) conn.destroy()
  queues.delete(guildId)
  console.log(`[voice] left guild ${guildId}`)
}

export async function speakText(guildId: string, text: string): Promise<void> {
  if (!text.trim()) return
  const conn = getVoiceConnection(guildId)
  if (!conn) return

  const q = queues.get(guildId) ?? []
  q.push({ text, guildId })
  queues.set(guildId, q)

  if (q.length === 1) {
    void processQueue(guildId)
  }
}

async function processQueue(guildId: string): Promise<void> {
  const q = queues.get(guildId)
  if (!q || q.length === 0) return

  const conn = getVoiceConnection(guildId)
  if (!conn) {
    queues.delete(guildId)
    return
  }

  const item = q[0]!
  const player = getOrCreatePlayer(guildId)

  try {
    const audio = await synthesizeSpeech(item.text)
    const resource = createAudioResource(Readable.from(audio), {
      inputType: StreamType.OggOpus,
    })
    player.play(resource)
    await entersState(player, AudioPlayerStatus.Idle, 120_000)
  } catch (e) {
    console.warn('[voice] TTS playback failed:', e)
  }

  q.shift()
  if (q.length > 0) {
    void processQueue(guildId)
  }
}

function cancelEmptyTimer(guildId: string): void {
  const t = emptyTimers.get(guildId)
  if (t) {
    clearTimeout(t)
    emptyTimers.delete(guildId)
  }
}

function startEmptyTimer(guildId: string): void {
  if (voiceAutoLeaveSeconds <= 0) return
  cancelEmptyTimer(guildId)
  const t = setTimeout(() => {
    emptyTimers.delete(guildId)
    const conn = getVoiceConnection(guildId)
    if (!conn) return
    leaveVoice(guildId)
    console.log(`[voice] auto-left empty VC in guild ${guildId}`)
  }, voiceAutoLeaveSeconds * 1000)
  t.unref()
  emptyTimers.set(guildId, t)
}

export function registerVoiceEvents(client: Client): void {
  if (!voiceTtsEnabled) return

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guild = newState.guild
    const conn = getVoiceConnection(guild.id)
    if (!conn) return

    const channelId = conn.joinConfig.channelId
    if (!channelId) return

    const channel = guild.channels.cache.get(channelId)
    if (!channel?.isVoiceBased()) return

    const members = channel.members.filter((m) => !m.user.bot)
    if (members.size === 0) {
      startEmptyTimer(guild.id)
    } else {
      cancelEmptyTimer(guild.id)
    }
  })
}

export async function autoJoinOnReady(client: Client): Promise<void> {
  if (!voiceTtsEnabled || !voiceAutoJoinChannelId) return
  try {
    const ch = await client.channels.fetch(voiceAutoJoinChannelId)
    if (!ch?.isVoiceBased()) {
      console.warn(
        '[voice] VOICE_AUTO_JOIN_CHANNEL_ID is not a voice channel:',
        voiceAutoJoinChannelId,
      )
      return
    }
    await joinChannel(ch as VoiceBasedChannel, client)
    console.log(`[voice] auto-joined ${ch.name}`)
  } catch (e) {
    console.warn('[voice] auto-join failed:', e)
  }
}
