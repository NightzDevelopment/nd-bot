import { SlashCommandBuilder } from 'discord.js'

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show bot commands and info'),
  new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Search FAQ from pinned messages in the FAQ channel')
    .addStringOption((o) =>
      o
        .setName('search')
        .setDescription('Keyword to filter FAQ (optional)')
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI one question (no conversation memory)')
    .addStringOption((o) =>
      o
        .setName('question')
        .setDescription('Your question')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear AI conversation memory in this channel'),
  new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show server information'),
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show user information')
    .addUserOption((o) =>
      o.setName('user').setDescription('User (optional)').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption((o) =>
      o.setName('user').setDescription('User to warn').setRequired(true),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('1 to 100').setRequired(true).setMinValue(1).setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text to English')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to translate').setRequired(true),
    ),
  new SlashCommandBuilder().setName('ping').setDescription('Bot latency check'),
  new SlashCommandBuilder()
    .setName('links')
    .setDescription('Support links (FAQ, tickets, rules)'),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('How to open a support ticket'),
  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Staff: list open support tickets'),
  new SlashCommandBuilder()
    .setName('ticketstats')
    .setDescription('Staff: ticket statistics for this server'),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search FAQ (alias for faq)')
    .addStringOption((o) =>
      o.setName('query').setDescription('Search text').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('product')
    .setDescription('Look up a product link by shorthand')
    .addStringOption((o) =>
      o.setName('name').setDescription('Product name or shorthand').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice (e.g. 2d6+1)')
    .addStringOption((o) =>
      o.setName('dice').setDescription('Default 1d20').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Pick one option')
    .addStringOption((o) =>
      o.setName('options').setDescription('Comma-separated choices').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('safety')
    .setDescription('Safety and reporting tips'),
  new SlashCommandBuilder()
    .setName('scamtips')
    .setDescription('Common scam patterns to avoid'),
  new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('What this bot may log in support channels'),
  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report an issue to staff (use responsibly)')
    .addStringOption((o) =>
      o
        .setName('category')
        .setDescription('Category')
        .setRequired(true)
        .addChoices(
          { name: 'Harassment', value: 'harassment' },
          { name: 'Scam / phishing', value: 'scam' },
          { name: 'NSFW', value: 'nsfw' },
          { name: 'Self-harm concern', value: 'selfharm' },
          { name: 'Doxxing', value: 'doxxing' },
          { name: 'Other', value: 'other' },
        ),
    )
    .addStringOption((o) =>
      o.setName('details').setDescription('What happened').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('automod_public')
    .setDescription('How automated moderation is used here'),
  new SlashCommandBuilder()
    .setName('scam_check')
    .setDescription('AI risk check on pasted text (not legal advice)')
    .addStringOption((o) =>
      o.setName('text').setDescription('Paste suspicious message').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('tldr')
    .setDescription('Short summary of pasted text')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to summarize').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('mod_automod')
    .setDescription('Staff: show AutoMod effective settings'),
]
