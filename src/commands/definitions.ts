import { ChannelType, SlashCommandBuilder } from 'discord.js'

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show categorized commands, AI info, and notices'),
  new SlashCommandBuilder()
    .setName('faq')
    .setDescription('Search FAQ from pinned messages in the FAQ channel')
    .addStringOption((o) =>
      o.setName('search').setDescription('Keyword to filter FAQ (optional)').setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI one question (no conversation memory)')
    .addStringOption((o) =>
      o.setName('question').setDescription('Your question').setRequired(true),
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
    .addUserOption((o) => o.setName('user').setDescription('User (optional)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption((o) => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete messages')
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('1 to 100')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100),
    ),
  new SlashCommandBuilder()
    .setName('translate')
    .setDescription('Translate text to English')
    .addStringOption((o) =>
      o.setName('text').setDescription('Text to translate').setRequired(true),
    ),
  new SlashCommandBuilder().setName('ping').setDescription('Bot latency check'),
  new SlashCommandBuilder()
    .setName('store')
    .setDescription('Nightz FaxStore link, bot listing snapshot status, and featured items'),
  new SlashCommandBuilder().setName('links').setDescription('Support links (FAQ, tickets, rules)'),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Where to open a Nightz support ticket (panel + queue info)'),
  new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Staff: list open tickets (filters optional)')
    .addStringOption((o) =>
      o
        .setName('filter')
        .setDescription('Restrict by claim or first staff reply')
        .setRequired(false)
        .addChoices(
          { name: 'All open tickets', value: 'all' },
          { name: 'Unclaimed only', value: 'unclaimed' },
          { name: 'Claimed only', value: 'claimed' },
          { name: 'No staff reply yet', value: 'awaiting_staff' },
        ),
    )
    .addStringOption((o) =>
      o
        .setName('reason_contains')
        .setDescription('Category contains this text (case-insensitive)')
        .setRequired(false)
        .setMaxLength(80),
    )
    .addStringOption((o) =>
      o
        .setName('sort')
        .setDescription('Sort order by opened time')
        .setRequired(false)
        .addChoices(
          { name: 'Oldest first (queue)', value: 'oldest_first' },
          { name: 'Newest first', value: 'newest_first' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('ticketstats')
    .setDescription('Staff: ticket stats (open, closed, avg. resolution, by category)'),
  new SlashCommandBuilder()
    .setName('ticketnote')
    .setDescription('Staff: set or clear a short note shown on this ticket')
    .addStringOption((o) =>
      o
        .setName('note')
        .setDescription('Note text (max 500 chars). Leave empty to clear.')
        .setRequired(false)
        .setMaxLength(500),
    ),
  new SlashCommandBuilder()
    .setName('ticketreply')
    .setDescription('Staff: post a saved template reply in this ticket')
    .addStringOption((o) =>
      o
        .setName('template')
        .setDescription('Template key (autocomplete)')
        .setRequired(true)
        .setAutocomplete(true),
    ),
  new SlashCommandBuilder()
    .setName('tickettemplates')
    .setDescription('Staff: manage ticket reply templates')
    .addSubcommand((sc) => sc.setName('list').setDescription('List all saved templates'))
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Add or replace a template')
        .addStringOption((o) =>
          o
            .setName('key')
            .setDescription('Short identifier (e.g. "install-help")')
            .setRequired(true)
            .setMaxLength(48),
        )
        .addStringOption((o) =>
          o
            .setName('title')
            .setDescription('Human-readable title')
            .setRequired(true)
            .setMaxLength(80),
        )
        .addStringOption((o) =>
          o
            .setName('body')
            .setDescription('Reply text (max 1800 chars)')
            .setRequired(true)
            .setMaxLength(1800),
        )
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Optional category filter')
            .setRequired(false)
            .setMaxLength(60),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('delete')
        .setDescription('Delete a template by key')
        .addStringOption((o) =>
          o.setName('key').setDescription('Template key').setRequired(true).setAutocomplete(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('ticketpriority')
    .setDescription('Staff: set the priority of this ticket')
    .addStringOption((o) =>
      o
        .setName('level')
        .setDescription('Priority level (drives SLA target & color)')
        .setRequired(true)
        .addChoices(
          { name: '[CRITICAL] Critical', value: 'critical' },
          { name: '[HIGH] High', value: 'high' },
          { name: '[NORMAL] Normal', value: 'normal' },
          { name: '[LOW] Low', value: 'low' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search FAQ (alias for faq)')
    .addStringOption((o) => o.setName('query').setDescription('Search text').setRequired(false)),
  new SlashCommandBuilder()
    .setName('product')
    .setDescription('Look up a product URL (cached FaxStore listing or PRODUCT_ALIAS_URLS alias)')
    .addStringOption((o) =>
      o.setName('name').setDescription('Product name or shorthand').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice (e.g. 2d6+1)')
    .addStringOption((o) => o.setName('dice').setDescription('Default 1d20').setRequired(false)),
  new SlashCommandBuilder()
    .setName('choose')
    .setDescription('Pick one option')
    .addStringOption((o) =>
      o.setName('options').setDescription('Comma-separated choices').setRequired(true),
    ),
  new SlashCommandBuilder().setName('safety').setDescription('Safety and reporting tips'),
  new SlashCommandBuilder().setName('scamtips').setDescription('Common scam patterns to avoid'),
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
    .addStringOption((o) => o.setName('details').setDescription('What happened').setRequired(true)),
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
    .setDescription('Show or switch AI provider (auto, gemini, claude, openai)')
    .addStringOption((o) =>
      o
        .setName('provider')
        .setDescription('Provider mode to set')
        .setRequired(false)
        .addChoices(
          { name: 'Auto (intent-based routing across providers)', value: 'auto' },
          { name: 'Gemini only', value: 'gemini' },
          { name: 'Claude only', value: 'claude' },
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
          o.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(300),
        )
        .addStringOption((o) =>
          o
            .setName('answers')
            .setDescription('Options separated by | (2-10)')
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
          o
            .setName('message_id')
            .setDescription('Poll message ID (right-click message → Copy ID)')
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('pin')
        .setDescription('Bookmark a poll message ID for staff (mods)')
        .addStringOption((o) =>
          o.setName('message_id').setDescription('Poll message ID').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('unpin')
        .setDescription('Remove a bookmarked poll ID (mods)')
        .addStringOption((o) =>
          o.setName('message_id').setDescription('Poll message ID').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('stats')
        .setDescription('Staff: show vote counts for a poll message')
        .addStringOption((o) =>
          o.setName('message_id').setDescription('Poll message ID').setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your Nightz community level and XP')
    .addUserOption((o) => o.setName('user').setDescription('User (optional)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the Nightz community XP leaderboard')
    .addStringOption((o) =>
      o
        .setName('window')
        .setDescription('Time window')
        .setRequired(false)
        .addChoices(
          { name: 'All time', value: 'all' },
          { name: 'This week', value: 'week' },
          { name: 'This month', value: 'month' },
        ),
    ),
  new SlashCommandBuilder()
    .setName('levelreset')
    .setDescription('Staff: reset a user’s level data')
    .addUserOption((o) => o.setName('user').setDescription('User to reset').setRequired(true)),
  new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set your AFK status')
    .addStringOption((o) =>
      o.setName('reason').setDescription('Why you are away').setRequired(false).setMaxLength(200),
    ),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Bot health, gateway ping, and AI provider status'),
  new SlashCommandBuilder()
    .setName('macro')
    .setDescription('Staff: saved text snippets')
    .addSubcommand((sc) => sc.setName('list').setDescription('List macro keys'))
    .addSubcommand((sc) =>
      sc
        .setName('run')
        .setDescription('Post a macro in this channel')
        .addStringOption((o) => o.setName('name').setDescription('Macro key').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Create or update a macro')
        .addStringOption((o) => o.setName('name').setDescription('Macro key').setRequired(true))
        .addStringOption((o) => o.setName('text').setDescription('Full text').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('case')
    .setDescription('Staff: moderation case log')
    .addSubcommand((sc) => sc.setName('list').setDescription('Recent cases in this server'))
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Log a case')
        .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true))
        .addStringOption((o) =>
          o.setName('action').setDescription('e.g. warn, timeout').setRequired(true),
        )
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Staff: set channel slowmode (seconds)')
    .addIntegerOption((o) =>
      o
        .setName('seconds')
        .setDescription('0-21600')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel (default: current)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('counters')
    .setDescription(
      'Staff: live server stats in channel names (nightz; ServerStats-style counters)',
    )
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Set a channel name to a stat (template must include {count})')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Text, announcement, voice, or stage channel to rename')
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice,
            ),
        )
        .addStringOption((o) =>
          o
            .setName('stat')
            .setDescription('Which number to show')
            .setRequired(true)
            .addChoices(
              { name: 'Total members', value: 'members' },
              { name: 'Human members (non-bot)', value: 'humans' },
              { name: 'Bots', value: 'bots' },
              { name: 'Boosts', value: 'boosts' },
              { name: 'Roles', value: 'roles' },
              { name: 'Emojis', value: 'emojis' },
              { name: 'Stickers', value: 'stickers' },
              { name: 'Text + announcement + forum', value: 'text_channels' },
              { name: 'Voice + stage', value: 'voice_channels' },
              { name: 'All channels', value: 'all_channels' },
              { name: 'Online+idle+dnd (needs Presence + Member cache)', value: 'online' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('template')
            .setDescription('Text with {count}, e.g. Members: {count} (default by stat)')
            .setRequired(false)
            .setMaxLength(90),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Stop updating a stat channel')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to remove')
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice,
            ),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName('list').setDescription('List registered stat channels in this server'),
    )
    .addSubcommand((sc) =>
      sc.setName('refresh').setDescription('Rename all stat channels in this server now'),
    ),
  new SlashCommandBuilder()
    .setName('addcommand')
    .setDescription('Create a custom command (use with !name in any channel)')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Command name (e.g., hello)')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(32),
    )
    .addStringOption((o) =>
      o
        .setName('response')
        .setDescription('Command response text')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2000),
    ),
  new SlashCommandBuilder()
    .setName('listcommands')
    .setDescription('List all available custom commands'),
  new SlashCommandBuilder()
    .setName('delcommand')
    .setDescription('Delete a custom command (creator only)')
    .addStringOption((o) =>
      o.setName('name').setDescription('Command name to delete').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('reputation')
    .setDescription('View and manage reputation points')
    .addSubcommand((sc) =>
      sc
        .setName('view')
        .setDescription("View your or someone else's reputation")
        .addUserOption((o) =>
          o.setName('user').setDescription('User to check (default: you)').setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('give')
        .setDescription('Award reputation to a helpful member')
        .addUserOption((o) => o.setName('user').setDescription('User to reward').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('points')
            .setDescription('Points to award (default 1)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(100),
        )
        .addStringOption((o) =>
          o.setName('reason').setDescription("Why you're giving reputation").setRequired(false),
        ),
    )
    .addSubcommand((sc) => sc.setName('leaderboard').setDescription('Top members by reputation')),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View and edit member profiles')
    .addSubcommand((sc) =>
      sc
        .setName('view')
        .setDescription("View a member's profile")
        .addUserOption((o) =>
          o.setName('user').setDescription('User profile (default: you)').setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('edit')
        .setDescription('Edit your profile bio')
        .addStringOption((o) =>
          o
            .setName('bio')
            .setDescription('Your bio (max 200 characters)')
            .setRequired(true)
            .setMaxLength(200),
        ),
    ),
  new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('View badges and achievements')
    .addSubcommand((sc) =>
      sc
        .setName('view')
        .setDescription('View achievements')
        .addUserOption((o) =>
          o.setName('user').setDescription('User (default: you)').setRequired(false),
        ),
    )
    .addSubcommand((sc) => sc.setName('all').setDescription('View all available achievements')),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Staff: manage user warnings')
    .addSubcommand((sc) =>
      sc
        .setName('view')
        .setDescription("View a user's warnings")
        .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Warn a user')
        .addUserOption((o) => o.setName('user').setDescription('User to warn').setRequired(true))
        .addStringOption((o) =>
          o.setName('reason').setDescription('Warning reason').setRequired(false).setMaxLength(200),
        ),
    )
    .addSubcommand((sc) => sc.setName('leaderboard').setDescription('Top users by warning count'))
    .addSubcommand((sc) =>
      sc
        .setName('clear')
        .setDescription('Clear all warnings for a user (admin)')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('usernote')
    .setDescription('Staff: add private notes on users')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Add a note on a user')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) =>
          o.setName('note').setDescription('Note text').setRequired(true).setMaxLength(500),
        )
        .addStringOption((o) =>
          o
            .setName('severity')
            .setDescription('Note severity')
            .setRequired(false)
            .addChoices(
              { name: 'Low', value: 'low' },
              { name: 'Medium', value: 'medium' },
              { name: 'High', value: 'high' },
            ),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('view')
        .setDescription('View notes on a user')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('auditlog')
    .setDescription('Staff: query Discord audit logs')
    .addUserOption((o) =>
      o.setName('user').setDescription('Filter by user (optional)').setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Filter by action type (optional)')
        .setRequired(false)
        .addChoices(
          { name: 'Bans', value: 'ban' },
          { name: 'Kicks', value: 'kick' },
          { name: 'Role changes', value: 'role' },
          { name: 'Message deletes', value: 'message_delete' },
          { name: 'Channel changes', value: 'channel' },
          { name: 'Permission changes', value: 'permission' },
        ),
    )
    .addIntegerOption((o) =>
      o
        .setName('limit')
        .setDescription('Number of entries (default 10, max 25)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25),
    ),
  new SlashCommandBuilder()
    .setName('dossier')
    .setDescription('Staff: full history for a user (warnings, cases, notes, reputation, tickets)')
    .addUserOption((o) =>
      o.setName('user').setDescription('User to look up').setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Community events with RSVP')
    .addSubcommand((sc) =>
      sc
        .setName('create')
        .setDescription('Staff: create an event')
        .addStringOption((o) => o.setName('title').setDescription('Event title').setRequired(true))
        .addStringOption((o) =>
          o.setName('in').setDescription('Starts in (e.g. 2h, 1d)').setRequired(true),
        )
        .addStringOption((o) =>
          o.setName('description').setDescription('Details').setRequired(false),
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Where to post (default: here)').setRequired(false),
        ),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('List upcoming events'))
    .addSubcommand((sc) =>
      sc
        .setName('cancel')
        .setDescription('Staff: cancel an event by ID')
        .addStringOption((o) => o.setName('id').setDescription('Event ID').setRequired(true)),
    ),
  new SlashCommandBuilder()
    .setName('levelrole')
    .setDescription('Staff: configure role rewards for reaching certain levels')
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Award a role when a member reaches a level')
        .addIntegerOption((o) =>
          o
            .setName('level')
            .setDescription('Level to trigger on (e.g. 5)')
            .setRequired(true)
            .setMinValue(1),
        )
        .addRoleOption((o) => o.setName('role').setDescription('Role to award').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Remove the role reward for a level')
        .addIntegerOption((o) =>
          o.setName('level').setDescription('Level to remove reward from').setRequired(true),
        ),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('Show all level role rewards')),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('NDC economy shop: buy items with your coins')
    .addSubcommand((sc) => sc.setName('list').setDescription('Browse available items'))
    .addSubcommand((sc) =>
      sc
        .setName('buy')
        .setDescription('Purchase an item from the shop')
        .addStringOption((o) =>
          o.setName('id').setDescription('Item ID (shown in /shop list)').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Staff: add an item to the shop')
        .addStringOption((o) =>
          o.setName('name').setDescription('Item name').setRequired(true).setMaxLength(50),
        )
        .addIntegerOption((o) =>
          o.setName('price').setDescription('Price in NDC').setRequired(true).setMinValue(1),
        )
        .addStringOption((o) =>
          o
            .setName('description')
            .setDescription('Short description')
            .setRequired(false)
            .setMaxLength(150),
        )
        .addRoleOption((o) =>
          o
            .setName('role')
            .setDescription('Role to grant on purchase (optional)')
            .setRequired(false),
        )
        .addIntegerOption((o) =>
          o
            .setName('stock')
            .setDescription('Limited stock (leave blank = unlimited)')
            .setRequired(false)
            .setMinValue(1),
        )
        .addStringOption((o) =>
          o
            .setName('emoji')
            .setDescription('Emoji for display (e.g. 🎭)')
            .setRequired(false)
            .setMaxLength(8),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Staff: remove an item from the shop')
        .addStringOption((o) => o.setName('id').setDescription('Item ID').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('edit')
        .setDescription('Staff: edit an existing shop item')
        .addStringOption((o) => o.setName('id').setDescription('Item ID').setRequired(true))
        .addStringOption((o) =>
          o.setName('name').setDescription('New name').setRequired(false).setMaxLength(50),
        )
        .addIntegerOption((o) =>
          o.setName('price').setDescription('New price in NDC').setRequired(false).setMinValue(1),
        )
        .addStringOption((o) =>
          o
            .setName('description')
            .setDescription('New description')
            .setRequired(false)
            .setMaxLength(150),
        )
        .addIntegerOption((o) =>
          o
            .setName('stock')
            .setDescription('New stock level (0 = sold out)')
            .setRequired(false)
            .setMinValue(0),
        )
        .addStringOption((o) =>
          o.setName('emoji').setDescription('New emoji').setRequired(false).setMaxLength(8),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName('manage').setDescription('Staff: list all items with IDs for editing/removal'),
    ),
  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your NDC wallet and bank balance')
    .addUserOption((o) => o.setName('user').setDescription('User (optional)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily NDC reward (20h cooldown)'),
  new SlashCommandBuilder().setName('work').setDescription('Work a job and earn NDC (1h cooldown)'),
  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Deposit NDC from wallet to bank')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Amount to deposit').setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('Withdraw NDC from bank to wallet')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Amount to withdraw').setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Send NDC to another member')
    .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Gamble your NDC (3% jackpot 5x, 37% win, 60% lose)')
    .addIntegerOption((o) =>
      o.setName('bet').setDescription('Amount to bet').setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another member (risky!)')
    .addUserOption((o) => o.setName('user').setDescription('Who to rob').setRequired(true)),
  new SlashCommandBuilder()
    .setName('crime')
    .setDescription('Commit a crime for quick cash (1h cooldown, 40% caught risk)'),
  new SlashCommandBuilder()
    .setName('heist')
    .setDescription('Plan and execute a heist (4h cooldown, high risk/reward)'),
  new SlashCommandBuilder()
    .setName('hunt')
    .setDescription('Hunt wild animals for NDC (30m cooldown)'),
  new SlashCommandBuilder()
    .setName('fish')
    .setDescription('Cast a line and catch fish for NDC (20m cooldown)'),
  new SlashCommandBuilder()
    .setName('mine')
    .setDescription('Mine for valuable ores and gems (45m cooldown)'),
  new SlashCommandBuilder()
    .setName('cooldowns')
    .setDescription('Show all your economy command cooldowns'),
  new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy leaderboard and stats')
    .addSubcommand((sc) => sc.setName('leaderboard').setDescription('Top NDC holders'))
    .addSubcommand((sc) => sc.setName('stats').setDescription('Your full economy stats')),
  new SlashCommandBuilder()
    .setName('stock')
    .setDescription('Virtual simulated stock market exchange')
    .addSubcommand((sc) =>
      sc.setName('list').setDescription('List all stock market symbols, prices, and changes'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('buy')
        .setDescription('Buy stock shares')
        .addStringOption((o) =>
          o.setName('symbol').setDescription('Stock symbol (e.g. ND)').setRequired(true),
        )
        .addNumberOption((o) =>
          o
            .setName('shares')
            .setDescription('Number of shares to buy')
            .setRequired(true)
            .setMinValue(0.001),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('sell')
        .setDescription('Sell stock shares')
        .addStringOption((o) =>
          o.setName('symbol').setDescription('Stock symbol (e.g. ND)').setRequired(true),
        )
        .addNumberOption((o) =>
          o
            .setName('shares')
            .setDescription('Number of shares to sell')
            .setRequired(true)
            .setMinValue(0.001),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('portfolio')
        .setDescription('View your current stock holdings and average cost basis'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('info')
        .setDescription('View 24h historical chart for a stock')
        .addStringOption((o) =>
          o.setName('symbol').setDescription('Stock symbol (e.g. ND)').setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play a game of Blackjack vs the Dealer')
    .addIntegerOption((o) =>
      o.setName('bet').setDescription('Amount to bet in NDC').setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slots machine')
    .addIntegerOption((o) =>
      o.setName('bet').setDescription('Amount to bet in NDC').setRequired(true).setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('Place a wager on the roulette wheel')
    .addIntegerOption((o) =>
      o.setName('bet').setDescription('Amount to bet in NDC').setRequired(true).setMinValue(1),
    )
    .addStringOption((o) =>
      o
        .setName('wager')
        .setDescription('Wager type: red, black, even, odd, low, high, or specific number (0-36)')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Wager NDC on a coinflip')
    .addIntegerOption((o) =>
      o.setName('bet').setDescription('Amount to bet in NDC').setRequired(true).setMinValue(1),
    )
    .addStringOption((o) =>
      o
        .setName('choice')
        .setDescription('Heads or Tails')
        .setRequired(true)
        .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }),
    ),
  new SlashCommandBuilder()
    .setName('timezone')
    .setDescription('Manage your timezone settings')
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Set your timezone')
        .addStringOption((o) =>
          o
            .setName('zone')
            .setDescription('Timezone name (e.g. America/New_York, Europe/London, UTC)')
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('view')
        .setDescription("View a member's timezone")
        .addUserOption((o) =>
          o.setName('user').setDescription('User (optional)').setRequired(false),
        ),
    ),
  new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Manage your daily quests')
    .addSubcommand((sc) =>
      sc.setName('view').setDescription('View your current daily quests progress'),
    )
    .addSubcommand((sc) =>
      sc.setName('claim').setDescription('Claim rewards for completed quests'),
    ),
]
