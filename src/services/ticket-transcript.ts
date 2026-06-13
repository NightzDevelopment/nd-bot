/**
 * Ticket Tool-style transcripts: paginated message fetch, HTML + plain text.
 */
import type { Guild, Message, TextChannel } from 'discord.js'
import type { TicketRecord } from './ticket-store.ts'

export function padTicketId(n: number): string {
  return String(n).padStart(4, '0')
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function nl2br(s: string): string {
  return escHtml(s).replace(/\n/g, '<br/>')
}

/** Fetch up to `max` messages, oldest-first. */
export async function fetchTicketMessages(channel: TextChannel, max: number): Promise<Message[]> {
  const cap = Math.max(1, Math.min(max, 5000))
  const collected: Message[] = []
  let lastId: string | undefined
  const batches = Math.ceil(cap / 100)
  for (let i = 0; i < batches; i++) {
    const remaining = cap - collected.length
    if (remaining <= 0) break
    const batch = await channel.messages.fetch({
      limit: Math.min(100, remaining),
      before: lastId,
    })
    if (batch.size === 0) break
    collected.push(...batch.values())
    lastId = batch.last()?.id
    if (batch.size < 100) break
  }
  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
  return collected
}

export function countUniqueAuthors(messages: Message[]): number {
  return new Set(messages.map((m) => m.author.id)).size
}

export type TranscriptMeta =
  | {
      kind: 'close'
      closedAt: number
      closedByTag: string
      staffNotes: string
      messageCount: number
      participantCount: number
    }
  | {
      kind: 'manual'
      exportedAt: number
      exportedByTag: string
      messageCount: number
      participantCount: number
    }

export function buildTranscriptTxt(
  ticket: TicketRecord,
  messages: Message[],
  meta: TranscriptMeta,
): Buffer {
  const closeBlock =
    meta.kind === 'close'
      ? [
          `Closed (UTC):    ${new Date(meta.closedAt).toISOString()}`,
          `Closed by:       ${meta.closedByTag}`,
          `Staff notes:     ${meta.staffNotes || '-'}`,
        ]
      : [
          `Export (UTC):    ${new Date(meta.exportedAt).toISOString()}`,
          `Exported by:     ${meta.exportedByTag}`,
          `Note:            Manual snapshot, ticket may still be open`,
        ]

  const lines: string[] = [
    '═'.repeat(72),
    `NIGHTZ DEVELOPMENT: SUPPORT TRANSCRIPT`,
    `Ticket #${padTicketId(ticket.id)}`,
    '═'.repeat(72),
    `Ticket ID:       #${padTicketId(ticket.id)}`,
    `Guild ID:        ${ticket.guildId}`,
    `Channel ID:      ${ticket.channelId}`,
    `Requester:       ${ticket.userTag} (${ticket.userId})`,
    `Category:        ${ticket.reason}`,
    `Workflow status: ${ticket.workflowStatus ?? '-'}`,
    `Opened (UTC):    ${new Date(ticket.openedAt).toISOString()}`,
    ...closeBlock,
    `Claimed by:      ${ticket.claimedByTag ?? '- (not claimed)'}`,
    `Messages logged: ${meta.messageCount}`,
    `Participants:    ${meta.participantCount}`,
    '═'.repeat(72),
    '',
  ]

  for (const m of messages) {
    const ts = new Date(m.createdTimestamp).toISOString()
    const body = m.content || '(no text)'
    const att =
      m.attachments.size > 0
        ? `\n  [attachments]\n${[...m.attachments.values()].map((a) => `  - ${a.name}: ${a.url}`).join('\n')}`
        : ''
    const embedNote = m.embeds.length ? `\n  [${m.embeds.length} embed(s) omitted]` : ''
    lines.push(`[${ts}] ${m.author.tag} (${m.author.id})`)
    lines.push(`${body}${att}${embedNote}`)
    lines.push('')
  }

  return Buffer.from(lines.join('\n'), 'utf8')
}

export function buildTranscriptHtml(
  guild: Guild,
  channel: TextChannel,
  ticket: TicketRecord,
  messages: Message[],
  meta: TranscriptMeta,
): Buffer {
  const guildIcon = guild.iconURL({ size: 128 }) ?? ''
  const title = `Ticket #${padTicketId(ticket.id)}: ${escHtml(ticket.reason)}`

  const closeGrid =
    meta.kind === 'close'
      ? `
      <div class="kv"><div class="k">Closed</div><div class="v">${escHtml(new Date(meta.closedAt).toISOString())}</div></div>
      <div class="kv"><div class="k">Closed by</div><div class="v">${escHtml(meta.closedByTag)}</div></div>
      <div class="kv" style="grid-column: 1 / -1"><div class="k">Staff notes</div><div class="v">${meta.staffNotes ? nl2br(meta.staffNotes) : '-'}</div></div>`
      : `
      <div class="kv"><div class="k">Exported</div><div class="v">${escHtml(new Date(meta.exportedAt).toISOString())}</div></div>
      <div class="kv"><div class="k">Exported by</div><div class="v">${escHtml(meta.exportedByTag)}</div></div>
      <div class="kv" style="grid-column: 1 / -1"><div class="k">Note</div><div class="v">Manual snapshot, conversation may continue after this export.</div></div>`

  const rows = messages
    .map((m) => {
      const av = m.author.displayAvatarURL({ size: 64 })
      const ts = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19)
      const atts =
        m.attachments.size > 0
          ? `<div class="atts">${[...m.attachments.values()]
              .map(
                (a) =>
                  `<a href="${escHtml(a.url)}" rel="noopener noreferrer" target="_blank">${escHtml(a.name || 'file')}</a>`,
              )
              .join(' · ')}</div>`
          : ''
      const embedNote =
        m.embeds.length > 0
          ? `<div class="embed-note">${m.embeds.length} embed(s), see Discord for full content</div>`
          : ''
      return `<div class="msg">
  <img class="av" src="${escHtml(av)}" width="40" height="40" alt="" />
  <div class="body">
    <div class="meta"><span class="author">${escHtml(m.author.tag)}</span> <span class="time">${escHtml(ts)} UTC</span></div>
    <div class="content">${m.content ? nl2br(m.content) : '<em>(no text)</em>'}</div>
    ${atts}
    ${embedNote}
  </div>
</div>`
    })
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
  :root {
    --bg: #1e1f22;
    --card: #2b2d31;
    --border: #3f4147;
    --text: #f2f3f5;
    --muted: #b5bac1;
    --accent: #5865f2;
    --link: #00a8fc;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "gg sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.45;
  }
  .wrap { max-width: 920px; margin: 0 auto; padding: 24px 16px 48px; }
  .hero {
    background: linear-gradient(135deg, #2b2d31 0%, #1e1f22 100%);
    border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px;
    margin-bottom: 24px;
  }
  .hero-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .hero img.guild { width: 56px; height: 56px; border-radius: 12px; }
  .hero h1 { margin: 0; font-size: 1.35rem; font-weight: 700; }
  .hero .sub { color: var(--muted); font-size: 0.9rem; margin-top: 6px; }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px 16px; margin-top: 16px;
  }
  .kv { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .kv .k { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 4px; }
  .kv .v { font-size: 0.9rem; word-break: break-word; }
  .msg {
    display: flex; gap: 12px; padding: 14px 12px; border-bottom: 1px solid var(--border);
    background: var(--card); margin-bottom: 8px; border-radius: 8px; border: 1px solid var(--border);
  }
  .msg .av { border-radius: 50%; flex-shrink: 0; }
  .meta { margin-bottom: 6px; }
  .author { font-weight: 600; }
  .time { color: var(--muted); font-size: 0.8rem; margin-left: 8px; }
  .content { font-size: 0.95rem; white-space: pre-wrap; word-break: break-word; }
  .atts { margin-top: 8px; font-size: 0.85rem; }
  .atts a { color: var(--link); }
  .embed-note { margin-top: 6px; font-size: 0.8rem; color: var(--muted); }
  footer {
    margin-top: 32px; text-align: center; color: var(--muted); font-size: 0.8rem;
    border-top: 1px solid var(--border); padding-top: 16px;
  }
  footer strong { color: var(--text); }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div class="hero-top">
      ${guildIcon ? `<img class="guild" src="${escHtml(guildIcon)}" alt=""/>` : ''}
      <div>
        <h1>${escHtml(guild.name)}: Support transcript</h1>
        <div class="sub">Nightz Development · Channel: #${escHtml(channel.name)} · Logged messages: ${meta.messageCount}</div>
      </div>
    </div>
    <div class="grid">
      <div class="kv"><div class="k">Ticket</div><div class="v">#${padTicketId(ticket.id)}</div></div>
      <div class="kv"><div class="k">Requester</div><div class="v">${escHtml(ticket.userTag)}<br/><span style="color:var(--muted);font-size:0.85rem">${ticket.userId}</span></div></div>
      <div class="kv"><div class="k">Category</div><div class="v">${escHtml(ticket.reason)}</div></div>
      <div class="kv"><div class="k">Workflow</div><div class="v">${ticket.workflowStatus ? escHtml(ticket.workflowStatus) : '-'}</div></div>
      <div class="kv"><div class="k">Opened</div><div class="v">${escHtml(new Date(ticket.openedAt).toISOString())}</div></div>
      <div class="kv"><div class="k">Claimed by</div><div class="v">${ticket.claimedByTag ? escHtml(ticket.claimedByTag) : '-'}</div></div>
      <div class="kv"><div class="k">Participants</div><div class="v">${meta.participantCount}</div></div>
      ${closeGrid}
    </div>
  </div>
  <div class="thread">
    ${rows || '<p style="color:var(--muted)">No messages in transcript.</p>'}
  </div>
  <footer>
    Generated by <strong>Nightz Network Live Support</strong> · Plain archive; formatting may differ from Discord.
  </footer>
</div>
</body>
</html>`

  return Buffer.from(html, 'utf8')
}
