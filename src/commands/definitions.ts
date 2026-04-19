import { ChannelType, SlashCommandBuilder } from 'discord.js'

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show categorized commands, AI info, and notices'),
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
    .setDescription('Show detailed server information (members, channels, boosts, security)'),
  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show account, server profile, roles, and permissions')
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
    .setDescription('Where to open a Nightz support ticket (panel + queue info)'),
  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Staff: list all open tickets in this server'),
  new SlashCommandBuilder()
    .setName('ticketstats')
    .setDescription('Staff: ticket stats (open, closed, avg. resolution, by category)'),
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
  new SlashCommandBuilder()
    .setName('ai_model')
    .setDescription('Show or switch AI provider (auto, gemini, openai)')
    .addStringOption((o) =>
      o
        .setName('provider')
        .setDescription('Provider mode to set')
        .setRequired(false)
        .addChoices(
          { name: 'Auto (Gemini then OpenAI fallback)', value: 'auto' },
          { name: 'Gemini only', value: 'gemini' },
          { name: 'OpenAI only', value: 'openai' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('polls')
    .setDescription('List native polls or post/end one (mods) in the polls channel')
    .addSubcommand((sc) =>
      sc.setName('list').setDescription('Show active native Discord polls in the polls channel(s)'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('create')
        .setDescription('Post a native poll (mods)')
        .addStringOption((o) =>
          o
            .setName('question')
            .setDescription('Poll question')
            .setRequired(true)
            .setMaxLength(300),
        )
        .addStringOption((o) =>
          o
            .setName('answers')
            .setDescription('Options separated by | (2–10)')
            .setRequired(true)
            .setMaxLength(550),
        )
        .addIntegerOption((o) =>
          o
            .setName('duration_hours')
            .setDescription('Duration in hours (default 24, max 168)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(168),
        )
        .addBooleanOption((o) =>
          o.setName('multiselect').setDescription('Allow multiple choices').setRequired(false),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Post here (default: first configured polls channel)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('end')
        .setDescription('End a native poll early (mods)')
        .addStringOption((o) =>
          o.setName('message_id').setDescription('Poll message ID (right-click message → Copy ID)').setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Bot joins your current voice channel (TTS)'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Bot leaves the voice channel'),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Speak text in voice channel via TTS')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to speak').setRequired(true),
    ),
]
