/**
 * Speech-to-text from Discord VC (opus packets) via Google Cloud Speech-to-Text,
 * then the same AI + TTS path as text (handleGuildAiFromVoiceTranscript).
 */
import { EndBehaviorType } from '@discordjs/voice'
import type { VoiceConnection } from '@discordjs/voice'
import type { Client, TextChannel } from 'discord.js'
import OpusScript from 'opusscript'
import {
  getVoiceSttReplyChannelId,
  voiceAutoJoinChannelId,
  voiceSttCooldownMs,
  voiceSttEnabled,
} from '../config.ts'

const sttAttached = new WeakSet<VoiceConnection>()
const sttCooldowns = new Map<string, number>()
const sttBusy = new Set<string>()

let speechClient: import('@google-cloud/speech').SpeechClient | null = null

async function getSpeechClient(): Promise<import('@google-cloud/speech').SpeechClient> {
  if (speechClient) return speechClient
  const { SpeechClient } = await import('@google-cloud/speech')
  speechClient = new SpeechClient()
  return speechClient
}

function decodeOpusPackets(chunks: Buffer[]): Buffer | null {
  if (chunks.length === 0) return null
  const decoder = new OpusScript(
    48000,
    2,
    OpusScript.Application.VOIP,
  )
  const out: Buffer[] = []
  for (const packet of chunks) {
    if (packet.length === 0) continue
    try {
      out.push(decoder.decode(packet))
    } catch {
      /* skip bad frame */
    }
  }
  try {
    decoder.delete()
  } catch {
    /* ignore */
  }
  if (out.length === 0) return null
  return Buffer.concat(out)
}

async function recognizeLinear16Pcm(pcm: Buffer): Promise<string> {
  const client = await getSpeechClient()
  const [response] = await client.recognize({
    config: {
      encoding: 'LINEAR16',
      sampleRateHertz: 48000,
      audioChannelCount: 2,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
    },
    audio: { content: pcm.toString('base64') },
  })
  const lines =
    response.results?.map((r) => r.alternatives?.[0]?.transcript ?? '') ?? []
  return lines.join(' ').trim()
}

export function attachVoiceSpeechToText(
  conn: VoiceConnection,
  client: Client,
  joinedChannelId: string,
): void {
  if (!voiceSttEnabled) return
  const replyId = getVoiceSttReplyChannelId()
  if (!replyId) {
    console.warn(
      '[voice-stt] VOICE_STT enabled but no reply channel: set VOICE_AI_TEXT_CHANNEL_IDS or VOICE_STT_REPLY_TEXT_CHANNEL_ID',
    )
    return
  }
  if (sttAttached.has(conn)) return
  sttAttached.add(conn)

  if (voiceAutoJoinChannelId && joinedChannelId !== voiceAutoJoinChannelId) {
    console.log(
      `[voice-stt] listening on VC ${joinedChannelId} (expected ${voiceAutoJoinChannelId} for auto-join STT)`,
    )
  }

  conn.receiver.speaking.on('start', (userId) => {
    if (userId === client.user?.id) return

    const guildId = conn.joinConfig.guildId
    const key = `${guildId}:${userId}`
    if (sttBusy.has(key)) return
    if (Date.now() - (sttCooldowns.get(key) ?? 0) < voiceSttCooldownMs) {
      return
    }

    sttBusy.add(key)

    const stream = conn.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1400,
      },
    })

    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => {
      void (async () => {
        try {
          const pcm = decodeOpusPackets(chunks)
          if (!pcm || pcm.length < 6000) {
            return
          }

          let transcript: string
          try {
            transcript = await recognizeLinear16Pcm(pcm)
          } catch (e) {
            console.warn('[voice-stt] Speech API error:', e)
            return
          }

          if (!transcript || transcript.length < 2) return
          console.log(`[voice-stt] "${transcript.slice(0, 120)}"`)

          const ch = await client.channels.fetch(replyId).catch(() => null)
          if (!ch?.isTextBased()) return
          const textChannel = ch as TextChannel
          const guild = textChannel.guild
          const member = await guild.members.fetch(userId).catch(() => null)
          const user = await client.users.fetch(userId)

          const { handleGuildAiFromVoiceTranscript } = await import(
            '../handlers/messages.ts'
          )
          await handleGuildAiFromVoiceTranscript({
            guild,
            channel: textChannel,
            user,
            member,
            transcript,
          })
        } catch (e) {
          console.warn('[voice-stt] pipeline error:', e)
        } finally {
          sttBusy.delete(key)
          sttCooldowns.set(key, Date.now())
        }
      })()
    })

    stream.on('error', (e) => {
      console.warn('[voice-stt] stream error:', e)
      sttBusy.delete(key)
    })
  })
}
