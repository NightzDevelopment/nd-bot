/**
 * Deterministic style cleanup for AI-generated text before it reaches Discord.
 *
 * Why this exists: LLMs love em dashes ("—") and ignore prompt instructions to
 * avoid them a good fraction of the time. A post-process pass guarantees the
 * output uses plain English punctuation regardless of what the model returns.
 *
 * Rules (in order):
 *  1. A line that STARTS with a dash + space is a bullet  -> "- " (keep as list).
 *  2. Number ranges ("20–25")                              -> hyphen ("20-25").
 *  3. A dash used as a spaced clause break (" — ")          -> ", ".
 *  4. A dash glued between letters ("word—word")            -> ", ".
 *  5. Any leftover long dash                                -> ", ".
 *  6. Tidy artifacts (" ,", ",,", ", .", double spaces).
 *
 * Targets em dash (—, U+2014), en dash (–, U+2013), horizontal bar (―, U+2015),
 * and the minus sign (−, U+2212). Regular hyphens ("-") are left untouched.
 */

// Character class of the "long dash" glyphs we replace.
const LONG_DASH = '\\u2014\\u2013\\u2015\\u2212'

export function sanitizeAiText(input: string): string {
  if (!input) return input
  let s = input

  // 1. Bullet at the start of a line: "— item" / "– item" -> "- item"
  s = s.replace(new RegExp(`^([ \\t]*)[${LONG_DASH}][ \\t]+`, 'gm'), '$1- ')

  // 2. Number ranges keep a normal hyphen: "20–25" -> "20-25"
  s = s.replace(new RegExp(`(\\d)\\s*[${LONG_DASH}]\\s*(\\d)`, 'g'), '$1-$2')

  // 3. Spaced clause break: "text — more" -> "text, more"
  s = s.replace(new RegExp(`\\s+[${LONG_DASH}]\\s+`, 'g'), ', ')

  // 4. Glued between word characters: "word—word" -> "word, word"
  s = s.replace(new RegExp(`([A-Za-z0-9])[${LONG_DASH}]([A-Za-z0-9])`, 'g'), '$1, $2')

  // 5. Anything still left -> comma
  s = s.replace(new RegExp(`[${LONG_DASH}]`, 'g'), ', ')

  // 6. Tidy up artifacts produced by the substitutions.
  s = s
    .replace(/ +,/g, ',') // " ," -> ","
    .replace(/,{2,}/g, ',') // ",," -> ","
    .replace(/,\s*([.!?;:])/g, '$1') // ", ." -> "."
    .replace(/[ \t]{2,}/g, ' ') // collapse runs of spaces/tabs

  return s
}
