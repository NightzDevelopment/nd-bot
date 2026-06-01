/**
 * nd! prefix commands for the Economy system.
 * Mirrors the slash commands: balance, daily, work, deposit, withdraw, pay,
 * gamble, rob, crime, heist, hunt, fish, mine, cooldowns, leaderboard, stats
 */
import type { Message } from 'discord.js'
import {
  claimDaily,
  claimWork,
  commitCrime,
  commitHeist,
  deposit,
  fish,
  gamble,
  getBalance,
  getCooldowns,
  hunt,
  mine,
  richestUsers,
  rob,
  transfer,
  withdraw,
} from '../services/economy-store.ts'
import { ndEmbed } from '../utils/embed.ts'

function parseAmount(arg: string): number | null {
  const cleaned = arg.replace(/[,_\s]/g, '').toLowerCase()
  // Support 1k, 2.5m, etc.
  const match = /^([\d.]+)\s*([kmb])?$/.exec(cleaned)
  if (!match) return null
  let n = parseFloat(match[1])
  if (!isFinite(n) || n < 0) return null
  const suffix = match[2]
  if (suffix === 'k') n *= 1_000
  else if (suffix === 'm') n *= 1_000_000
  else if (suffix === 'b') n *= 1_000_000_000
  return Math.floor(n)
}

function fmtCooldownRemaining(ms: number): string {
  if (ms === 0) return '[READY] **Ready!**'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  if (h > 0) return `[WAIT] ${h}h ${m}m`
  if (m > 0) return `[WAIT] ${m}m ${s}s`
  return `[WAIT] ${s}s`
}

/**
 * Returns true if the message was an economy command and was handled.
 */
export async function handleEconomyPrefix(
  msg: Message,
  cmd: string,
  args: string,
): Promise<boolean> {
  const userId = msg.author.id

  // ── Balance / Wallet ──────────────────────────────────────────────────────
  if (cmd === 'balance' || cmd === 'bal' || cmd === 'wallet') {
    const target = msg.mentions.users.first() ?? msg.author
    const rec = await getBalance(target.id)
    const embed = ndEmbed()
      .setTitle(`${target.username}'s Balance`)
      .addFields(
        { name: 'Wallet', value: `**${rec.balance.toLocaleString()} NDC**`, inline: true },
        { name: 'Bank', value: `**${rec.bank.toLocaleString()} NDC**`, inline: true },
        {
          name: 'Total',
          value: `**${(rec.balance + rec.bank).toLocaleString()} NDC**`,
          inline: true,
        },
        {
          name: 'Lifetime Earned',
          value: `${rec.totalEarned.toLocaleString()} NDC`,
          inline: false,
        },
      )
      .setColor(0xf5c542)
    await msg.reply({ embeds: [embed] })
    return true
  }

  // ── Daily ─────────────────────────────────────────────────────────────────
  if (cmd === 'daily') {
    const result = await claimDaily(userId)
    await replyWithReceiptPrefix(msg, 'DAILY REWARD', result, result.ok)
    return true
  }

  // ── Work ──────────────────────────────────────────────────────────────────
  if (cmd === 'work') {
    const result = await claimWork(userId)
    await replyWithReceiptPrefix(msg, 'WORK TRANSACTION', result, result.ok)
    return true
  }

  // ── Deposit ───────────────────────────────────────────────────────────────
  if (cmd === 'deposit' || cmd === 'dep') {
    const amount = parseAmount(args)
    if (amount === null || amount <= 0) {
      await msg.reply('Usage: `nd!deposit <amount>` (supports `1k`, `2.5m`, etc.)')
      return true
    }
    const result = await deposit(userId, amount)
    await msg.reply(result.msg)
    return true
  }

  // ── Withdraw ──────────────────────────────────────────────────────────────
  if (cmd === 'withdraw' || cmd === 'with') {
    const amount = parseAmount(args)
    if (amount === null || amount <= 0) {
      await msg.reply('Usage: `nd!withdraw <amount>` (supports `1k`, `2.5m`, etc.)')
      return true
    }
    const result = await withdraw(userId, amount)
    await msg.reply(result.msg)
    return true
  }

  // ── Pay / Transfer ────────────────────────────────────────────────────────
  if (cmd === 'pay' || cmd === 'give' || cmd === 'transfer') {
    const target = msg.mentions.users.first()
    if (!target) {
      await msg.reply('Usage: `nd!pay @user <amount>`')
      return true
    }
    if (target.id === userId) {
      await msg.reply("You can't pay yourself.")
      return true
    }
    // Strip mention from args to find amount
    const amountStr = args.replace(/<@!?\d+>/g, '').trim()
    const amount = parseAmount(amountStr)
    if (amount === null || amount <= 0) {
      await msg.reply('Usage: `nd!pay @user <amount>`')
      return true
    }
    const result = await transfer(userId, target.id, amount)
    const reply = result.ok ? `${result.msg} to **${target.username}**.` : result.msg
    await msg.reply(reply)
    return true
  }

  // ── Gamble ────────────────────────────────────────────────────────────────
  if (cmd === 'gamble' || cmd === 'bet') {
    const amount = parseAmount(args)
    if (amount === null || amount <= 0) {
      await msg.reply('Usage: `nd!gamble <amount>`')
      return true
    }
    const result = await gamble(userId, amount)
    await msg.reply(result.msg)
    return true
  }

  // ── Rob ───────────────────────────────────────────────────────────────────
  if (cmd === 'rob' || cmd === 'steal') {
    if (!msg.guild) {
      await msg.reply('Use in a server.')
      return true
    }
    const target = msg.mentions.users.first()
    if (!target) {
      await msg.reply('Usage: `nd!rob @user`')
      return true
    }
    if (target.id === userId) {
      await msg.reply("You can't rob yourself.")
      return true
    }
    const result = await rob(userId, target.id)
    await replyWithReceiptPrefix(msg, 'ROBBERY REGISTER', result, result.ok)
    return true
  }

  // ── Crime ─────────────────────────────────────────────────────────────────
  if (cmd === 'crime') {
    const result = await commitCrime(userId)
    await replyWithReceiptPrefix(msg, 'CRIME DISPATCH', result, result.result === 'success')
    return true
  }

  // ── Heist ─────────────────────────────────────────────────────────────────
  if (cmd === 'heist') {
    const result = await commitHeist(userId)
    await replyWithReceiptPrefix(msg, 'HEIST BREACH', result, result.result === 'success')
    return true
  }

  // ── Hunt ──────────────────────────────────────────────────────────────────
  if (cmd === 'hunt') {
    const result = await hunt(userId)
    await replyWithReceiptPrefix(msg, 'HUNT VENTURE', result, result.ok)
    return true
  }

  // ── Fish ──────────────────────────────────────────────────────────────────
  if (cmd === 'fish' || cmd === 'fishing') {
    const result = await fish(userId)
    await replyWithReceiptPrefix(msg, 'FISHING EXPEDITION', result, result.ok)
    return true
  }

  // ── Mine ──────────────────────────────────────────────────────────────────
  if (cmd === 'mine' || cmd === 'mining') {
    const result = await mine(userId)
    await replyWithReceiptPrefix(msg, 'MINING EXCAVATION', result, result.ok)
    return true
  }

  // ── Cooldowns ─────────────────────────────────────────────────────────────
  if (cmd === 'cooldowns' || cmd === 'cd' || cmd === 'cds') {
    const cooldowns = await getCooldowns(userId)
    const labels: Record<string, string> = {
      daily: '[DAILY]',
      work: '[WORK]',
      crime: '[CRIME]',
      heist: '[HEIST]',
      hunt: '[HUNT]',
      fish: '[FISH]',
      mine: '[MINE]',
    }
    const lines = cooldowns.map(
      (c) =>
        `${labels[c.command] || '[CMD]'} \`nd!${c.command}\` -- ${fmtCooldownRemaining(c.remainingMs)}`,
    )
    const embed = ndEmbed()
      .setTitle('Your Economy Cooldowns')
      .setDescription(lines.join('\n'))
      .setColor(0x60a5fa)
    await msg.reply({ embeds: [embed] })
    return true
  }

  // ── Leaderboard / Richest ─────────────────────────────────────────────────
  if (cmd === 'leaderboard-economy' || cmd === 'richest' || cmd === 'rich' || cmd === 'top') {
    const top = await richestUsers(10)
    if (!top.length) {
      await msg.reply('No economy data yet.')
      return true
    }
    const medals = ['[1ST]', '[2ND]', '[3RD]']
    const lines = top.map((r, i) => {
      const m = medals[i] ?? `**${i + 1}.**`
      return `${m} <@${r.userId}> -- **${r.total.toLocaleString()} NDC** (wallet: ${r.balance.toLocaleString()}, bank: ${r.bank.toLocaleString()})`
    })
    const embed = ndEmbed()
      .setTitle('NDC Richest Members')
      .setDescription(lines.join('\n'))
      .setColor(0xf5c542)
    await msg.reply({ embeds: [embed] })
    return true
  }

  // ── Economy Stats ─────────────────────────────────────────────────────────
  if (cmd === 'econ' || cmd === 'economy' || cmd === 'stats') {
    const rec = await getBalance(userId)
    const embed = ndEmbed()
      .setTitle('Your Economy Stats')
      .addFields(
        { name: 'Wallet', value: `${rec.balance.toLocaleString()} NDC`, inline: true },
        { name: 'Bank', value: `${rec.bank.toLocaleString()} NDC`, inline: true },
        { name: 'Total', value: `${(rec.balance + rec.bank).toLocaleString()} NDC`, inline: true },
        { name: 'Total Earned', value: `${rec.totalEarned.toLocaleString()} NDC`, inline: true },
        {
          name: 'Last Daily',
          value: rec.lastDaily ? `<t:${Math.floor(rec.lastDaily / 1000)}:R>` : 'Never',
          inline: true,
        },
        {
          name: 'Last Work',
          value: rec.lastWork ? `<t:${Math.floor(rec.lastWork / 1000)}:R>` : 'Never',
          inline: true,
        },
      )
      .setColor(0xf5c542)
    await msg.reply({ embeds: [embed] })
    return true
  }

  return false
}

async function replyWithReceiptPrefix(
  msg: any,
  title: string,
  result: { ok: boolean; amount: number; msg: string; balance?: number },
  isSuccess: boolean,
) {
  if (!result.ok) {
    await msg.reply(result.msg)
    return
  }

  try {
    const { getBalance } = await import('../services/economy-store.ts')
    const balanceRec = await getBalance(msg.author.id)
    const avatarUrl = msg.author.displayAvatarURL({ extension: 'png', size: 128 })

    const { generateReceiptCard } = await import('../services/receipt-card.ts')
    const buffer = await generateReceiptCard({
      userId: msg.author.id,
      username: msg.author.username,
      avatarUrl,
      title,
      description: result.msg.replace(/^\[[A-Z]+\]\s*/, ''),
      amount: result.amount,
      balance: balanceRec.balance,
      isSuccess,
    })

    const { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import(
      'discord.js'
    )
    const file = new AttachmentBuilder(buffer, { name: `receipt-${msg.author.id}.png` })

    // Determine repeatable commands and build quick-action repeat buttons
    let action: string | null = null
    let label = ''
    if (title === 'WORK TRANSACTION') {
      action = 'work'
      label = '[Work Again]'
    } else if (title === 'CRIME DISPATCH') {
      action = 'crime'
      label = '[Commit Crime]'
    } else if (title === 'HEIST BREACH') {
      action = 'heist'
      label = '[Attempt Heist]'
    } else if (title === 'HUNT VENTURE') {
      action = 'hunt'
      label = '[Hunt Again]'
    } else if (title === 'FISHING EXPEDITION') {
      action = 'fish'
      label = '[Fish Again]'
    } else if (title === 'MINING EXCAVATION') {
      action = 'mine'
      label = '[Mine Again]'
    }

    const components: any[] = []
    if (action) {
      const repeatButton = new ButtonBuilder()
        .setCustomId(`econ_repeat_${action}_${msg.author.id}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(repeatButton))
    }

    await msg.reply({ files: [file], components })
  } catch (err) {
    console.error('[receipt-prefix] Error generating card receipt, falling back to text:', err)
    await msg.reply({ content: result.msg, components: [] })
  }
}
