/** Roll NdX+M (e.g. 2d6+1). Caps count and sides for abuse prevention. */
export function rollDiceSpec(spec: string): string {
  const s = spec.trim().replace(/\s/g, '') || '1d20'
  const m = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(s)
  if (!m) return 'Invalid dice. Use e.g. `2d6` or `1d20+3`.'
  const n = Math.min(20, Math.max(1, parseInt(m[1]!, 10)))
  const sides = Math.min(100, Math.max(2, parseInt(m[2]!, 10)))
  const mod = m[3] ? parseInt(m[3], 10) : 0
  let total = 0
  const rolls: number[] = []
  for (let i = 0; i < n; i++) {
    const r = 1 + Math.floor(Math.random() * sides)
    rolls.push(r)
    total += r
  }
  total += mod
  const modStr = m[3] ? m[3] : ''
  return `Rolled **${spec}**: [${rolls.join(', ')}]${modStr ? ` ${modStr}` : ''} = **${total}**`
}
