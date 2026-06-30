/**
 * Light fun commands (UnbelievaBoat-style).
 *
 *   nd!dad-joke
 *   nd!truth / nd!dare / nd!tod
 *   nd!nhie            (never have i ever)
 *   nd!cat / nd!dog
 *
 * Text prompts are built-in lists so they never depend on an external service.
 * cat/dog fetch a public no-key image API with a timeout and degrade gracefully.
 */
import type { Message } from 'discord.js'
import { ndEmbed } from '../utils/embed.ts'

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)] as T

const DAD_JOKES: readonly string[] = [
  'I only know 25 letters of the alphabet. I do not know y.',
  'What do you call a fish with no eyes? A fsh.',
  'I used to hate facial hair, but then it grew on me.',
  'I would tell you a construction joke, but I am still working on it.',
  'Why do not skeletons fight each other? They do not have the guts.',
  'What did the ocean say to the beach? Nothing, it just waved.',
  'I am reading a book about anti-gravity. It is impossible to put down.',
  'Why did the scarecrow win an award? He was outstanding in his field.',
  'I do not trust stairs. They are always up to something.',
  'What do you call cheese that is not yours? Nacho cheese.',
]

const TRUTHS: readonly string[] = [
  'What is the last lie you told?',
  'What is a fear you have never told anyone?',
  'What is the most embarrassing thing in your search history?',
  'Who in this server would you trust with your password?',
  'What is the pettiest reason you stopped talking to someone?',
  'What is a skill you pretend to have but do not?',
]

const DARES: readonly string[] = [
  'Change your nickname to something the server picks for the next hour.',
  'Type your next three messages in all caps.',
  'Send the fifth photo in your camera roll (keep it appropriate).',
  'Speak only in questions for the next five minutes.',
  'Give a genuine compliment to the last three people who messaged.',
  'Pin your most embarrassing recent message (if you can).',
]

const NHIE: readonly string[] = [
  'Never have I ever fallen asleep in a meeting or class.',
  'Never have I ever sent a text to the wrong person.',
  'Never have I ever pretended to know someone I did not.',
  'Never have I ever rage quit a game.',
  'Never have I ever forgotten my own password more than three times.',
  'Never have I ever stayed up all night coding.',
]

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown | null> {
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(to)
  }
}

export async function handleFunCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd === 'dad-joke' || cmd === 'dadjoke') {
    await msg.reply(pick(DAD_JOKES))
    return true
  }

  if (cmd === 'truth') {
    await msg.reply({ embeds: [ndEmbed().setTitle('Truth').setDescription(pick(TRUTHS))] })
    return true
  }
  if (cmd === 'dare') {
    await msg.reply({ embeds: [ndEmbed().setTitle('Dare').setDescription(pick(DARES))] })
    return true
  }
  if (cmd === 'tod') {
    const isTruth = Math.random() < 0.5
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle(isTruth ? 'Truth' : 'Dare')
          .setDescription(isTruth ? pick(TRUTHS) : pick(DARES)),
      ],
    })
    return true
  }
  if (cmd === 'nhie' || cmd === 'neverhaveiever') {
    await msg.reply({ embeds: [ndEmbed().setTitle('Never have I ever').setDescription(pick(NHIE))] })
    return true
  }

  if (cmd === 'dog') {
    const data = (await fetchJson('https://dog.ceo/api/breeds/image/random')) as {
      message?: string
      status?: string
    } | null
    if (!data?.message || data.status !== 'success') {
      await msg.reply('Could not fetch a dog right now. Try again in a moment.')
      return true
    }
    await msg.reply({ embeds: [ndEmbed().setTitle('Woof').setImage(data.message)] })
    return true
  }

  if (cmd === 'cat') {
    const data = (await fetchJson('https://api.thecatapi.com/v1/images/search')) as
      | Array<{ url?: string }>
      | null
    const url = Array.isArray(data) ? data[0]?.url : undefined
    if (!url) {
      await msg.reply('Could not fetch a cat right now. Try again in a moment.')
      return true
    }
    await msg.reply({ embeds: [ndEmbed().setTitle('Meow').setImage(url)] })
    return true
  }

  return false
}
