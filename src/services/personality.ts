/**
 * Bot personality: switch the AI's tone between helpful, funny, and auto.
 *
 * - helpful: professional ND support brand (the original behavior).
 * - funny: witty, sassy clapbacks, still helpful for real questions.
 * - auto (default): read the room. Banter -> clapback; real question -> help;
 *   someone upset or a serious topic -> kind and professional.
 *
 * Tickets and support are ALWAYS forced to professional regardless of mode.
 * All modes keep a hard clean limit (no slurs, hate, attacks on appearance or
 * protected traits, or genuinely cruel content).
 *
 *   nd!personality [auto|funny|helpful]   (staff) view or set the mode
 *   nd!roast [@user|me]                    opt-in clean roast
 */
import type { Message } from 'discord.js'
import { personalityMode as personalityDefaultMode } from '../config.ts'
import { readJson, writeJson } from './data-store.ts'
import { generateOnce, getModel } from './gemini.ts'
import { ndEmbed } from '../utils/embed.ts'
import { isGuildMod } from '../utils/permissions.ts'

export type PersonalityMode = 'auto' | 'funny' | 'helpful'
const MODES: readonly PersonalityMode[] = ['auto', 'funny', 'helpful']

const FILE = 'personality.json'
let cache: { mode: PersonalityMode } | null = null

function coerceMode(v: unknown): PersonalityMode {
  return MODES.includes(v as PersonalityMode) ? (v as PersonalityMode) : 'auto'
}

async function load(): Promise<{ mode: PersonalityMode }> {
  if (!cache) {
    const raw = await readJson<{ mode?: string }>(FILE, {})
    cache = { mode: raw.mode ? coerceMode(raw.mode) : coerceMode(personalityDefaultMode) }
  }
  return cache
}

export async function getPersonalityMode(): Promise<PersonalityMode> {
  return (await load()).mode
}

export async function setPersonalityMode(mode: PersonalityMode): Promise<void> {
  cache = { mode }
  await writeJson(FILE, cache)
}

const CLEAN_LIMITS =
  'Hard limits at all times: keep it clean and PG-13, no slurs, no hate, no attacks on ' +
  "someone's appearance, race, religion, gender, sexuality, or disability, and nothing " +
  'genuinely cruel. If someone seems actually upset or is on a serious topic (moderation, ' +
  'safety, payments, a real problem), drop the jokes and be kind and professional.'

const PROFESSIONAL =
  'Maintain a professional, helpful Nightz Development (ND) support tone. Represent ND ' +
  'administration; this is proprietary ND property.'

const OVERRIDE =
  'This tone OVERRIDES any earlier instruction to stay strictly professional or corporate in ' +
  'casual public channels. '

const ESCALATE =
  'Escalate to match. Read the prior messages to gauge how persistent the user is: if they keep ' +
  'pushing, double down, or get more disrespectful as it goes, sharpen your comebacks and give ' +
  'as good as you get. Do not roll over or keep repeating the same soft line: get more cutting ' +
  'and pointed the harder they come. It is still banter, not a real fight, so the clean limits ' +
  'always hold, and the moment they let up or seem genuinely hurt, ease off.'

const FUNNY =
  `${OVERRIDE}You are a sharp, quick-witted, cocky AI with real attitude, and you live for a ` +
  'good clapback. When anyone teases you, trash-talks, calls you names, throws shade, or tests ' +
  'you, come back HARD and fast: lead with a bold, cutting, genuinely funny comeback. Do not ' +
  'hedge, do not soften it, do not give a diplomatic or "well, actually" reply, and never just ' +
  'take it or thank them for the feedback. Be cocky, own the room, and roast them right back, ' +
  'harder than they hit you. When they ask a real question you still answer it well, just with ' +
  `swagger. ${ESCALATE} ${CLEAN_LIMITS}`

const AUTO =
  `${OVERRIDE}Read the room. When the user is joking, teasing you, trash-talking, calling you ` +
  'names, throwing shade, or testing you (for example "what up loser") and is not genuinely ' +
  'upset, do NOT give a polite corporate reply and do NOT just take it: clap back HARD with a ' +
  'bold, cutting, funny comeback that out-does their energy. Be cocky and quick, do not hedge ' +
  'or water it down. If they ask a real question or need help, drop the bit and be genuinely ' +
  'helpful and clear (a little wit is fine, but the answer comes first). Never start on someone ' +
  `who was not bantering. ${ESCALATE} ${CLEAN_LIMITS}`

/** Tone directive injected into the AI turn. Tickets/support are always professional. */
export async function personalityToneDirective(isInTicket: boolean): Promise<string> {
  if (isInTicket) return PROFESSIONAL
  const mode = await getPersonalityMode()
  if (mode === 'funny') return FUNNY
  if (mode === 'auto') return AUTO
  return PROFESSIONAL
}

export async function handlePersonalityCommand(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  if (cmd !== 'personality' && cmd !== 'tone') return false
  const arg = args.trim().toLowerCase()
  if (!arg) {
    const mode = await getPersonalityMode()
    await msg.reply({
      embeds: [
        ndEmbed()
          .setTitle('Bot personality')
          .setDescription(
            `Current mode: **${mode}**\n\n` +
              '`auto` reads the room (funny when bantering, helpful for real questions).\n' +
              '`funny` leans witty and sassy.\n' +
              '`helpful` stays professional.\n\n' +
              'Staff set it with `nd!personality <auto|funny|helpful>`. Tickets are always professional.',
          ),
      ],
    })
    return true
  }
  const member = msg.member ?? (await msg.guild?.members.fetch(msg.author.id).catch(() => null)) ?? null
  if (!isGuildMod(member)) {
    await msg.reply('Only staff can change the bot personality.')
    return true
  }
  if (!MODES.includes(arg as PersonalityMode)) {
    await msg.reply('Usage: `nd!personality <auto|funny|helpful>`')
    return true
  }
  await setPersonalityMode(arg as PersonalityMode)
  await msg.reply(`Personality set to **${arg}**.`)
  return true
}

// ---- nd!roast (opt-in) ----------------------------------------------------

const roastCooldown = new Map<string, number>()
const ROAST_COOLDOWN_MS = 20_000

export async function handleRoastCommand(msg: Message, cmd: string, args: string): Promise<boolean> {
  if (cmd !== 'roast') return false

  const now = Date.now()
  const last = roastCooldown.get(msg.author.id) ?? 0
  if (now - last < ROAST_COOLDOWN_MS) {
    await msg.reply('Give me a second to think of something good.')
    return true
  }

  const mentioned = msg.mentions.users.first()
  const arg = args.trim().toLowerCase()
  const target = mentioned ?? msg.author
  const selfRoast = target.id === msg.author.id || arg === 'me'

  if (mentioned?.bot) {
    await msg.reply('I do not roast other bots. We have an understanding.')
    return true
  }

  roastCooldown.set(msg.author.id, now)
  const name = (msg.guild?.members.cache.get(target.id)?.displayName ?? target.username).slice(0, 60)

  const prompt =
    `Write a short, clever, funny roast of a Discord user named "${name}". This is opt-in ` +
    `comedy (${selfRoast ? 'they asked to roast themselves' : 'someone called for a roast'}), so ` +
    'make it sharp and witty. Roast their vibe, ego, typing, or gamer habits playfully. ' +
    'Hard rules: keep it clean and PG-13. No slurs, no hate, nothing about race, religion, ' +
    'gender, sexuality, or disability, no attacks on their real appearance, no serious or ' +
    'sensitive topics. 1 to 2 sentences. No preamble, no quotation marks, just the roast.'

  try {
    const reply = await generateOnce(getModel(''), prompt)
    const text = reply.trim().slice(0, 400) || 'You are so unremarkable I could not even roast you. Congrats?'
    await msg.reply(mentioned ? `${target}, ${text}` : text)
  } catch {
    await msg.reply('My roast generator is on cooldown. Consider yourself spared.')
  }
  return true
}
