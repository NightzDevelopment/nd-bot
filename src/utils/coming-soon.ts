import { comingSoonNormalizedNeedles, comingSoonRepliesEnabled } from '../config.ts'

export function isComingSoonTopic(text: string): boolean {
  if (!comingSoonRepliesEnabled || comingSoonNormalizedNeedles.length === 0) {
    return false
  }
  const t = text.toLowerCase().replace(/[^a-z0-9]/g, '')
  return comingSoonNormalizedNeedles.some((n) => t.includes(n))
}

const REPLIES: string[] = [
  'That one’s still **coming soon**, I don’t have public setup docs for it yet.',
  '**Not released yet.** Watch announcements or the store for when it’s available.',
  'I **can’t really say** much about that resource right now; it isn’t out for general support.',
  'That product is **still in the works.** We’ll post in product updates when it ships.',
  'That’s **coming soon**, I’m not able to walk through install or config until it’s public.',
  'I don’t have anything solid I can share on that one yet; basically **TBD**.',
  '**Can’t help with that yet**, it isn’t a released script on our side.',
  'If it’s **not on the store** as a shipped product, I have to keep it vague, stay tuned.',
  'That’s a **future release**; I’d be guessing if I went into detail.',
  '**No public docs** for that one yet, coming soon is the honest answer.',
  'I’m going to **pass** on specifics there, not released, so I can’t treat it like a live product.',
  'Think **“soon”**, I’m not the right source for deep setup on that until it’s out.',
]

const lastReplyByScope = new Map<string, string>()

/** Pick a canned line; avoids sending the exact same line twice in a row in `scopeId` (e.g. channel id). */
export function randomComingSoonReply(scopeId: string): string {
  const avoid = lastReplyByScope.get(scopeId)
  const pool = avoid && REPLIES.length > 1 ? REPLIES.filter((r) => r !== avoid) : REPLIES
  const pick = pool[Math.floor(Math.random() * pool.length)]!
  lastReplyByScope.set(scopeId, pick)
  return pick
}

/** Call after a normal AI reply so the next coming-soon line is not biased by the last canned reply. */
export function clearComingSoonReplyLast(scopeId: string): void {
  lastReplyByScope.delete(scopeId)
}
