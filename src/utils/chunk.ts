/** Discord message cap, stay under hard limit */
const CHUNK = 1900

export function chunkText(text: string): string[] {
  const t = text.trim()
  if (!t) return ['(no text)']
  if (t.length <= CHUNK) return [t]
  const out: string[] = []
  let rest = t
  while (rest.length > CHUNK) {
    let cut = CHUNK
    const nl = rest.lastIndexOf('\n', CHUNK)
    if (nl > CHUNK / 2) cut = nl
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}
