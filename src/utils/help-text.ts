import type { EmbedBuilder } from 'discord.js'
import { ndEmbed } from './embed.ts'

/**
 * Help embed for `nd!help` and `/help`: categorized commands + AI / privacy copy.
 */
export function buildHelpEmbed(): EmbedBuilder {
  return ndEmbed()
    .setTitle('[ND] Nightz Development Bot')
    .setDescription(
      '**AI in this server:** @mention the bot or reply to its message (about 2 minutes without pinging again). ' +
        '**DMs** always use the AI when DMs are enabled.',
    )
    .addFields(
      {
        name: 'General',
        value:
          '**Prefix:** `nd!help` · `nd!faq` · `nd!ask` · `nd!clear` · `nd!translate` / `nd!en` · `nd!ping` · `nd!status` · `nd!links` · `nd!store` · `nd!search` · `nd!product` · `nd!roll` · `nd!choose`\n' +
          '**Slash:** `/help` · `/faq` · `/ask` · `/clear` · `/translate` · `/ping` · `/status` · `/links` · `/store` · `/search` · `/product` · `/roll` · `/choose`',
        inline: false,
      },
      {
        name: 'Moderation (staff)',
        value:
          '**Prefix:** `nd!summarize` (reply to a message) · `nd!digest` · `nd!warn` · `nd!warnings` · `nd!clearwarns` · `nd!timeout` · `nd!kick` · `nd!ban` · `nd!purge` · `nd!lockdown` · `nd!unlock` · `nd!modautomod` · `nd!model <auto|gemini|openai>` · `nd!macro` · `nd!case` · `nd!slowmode` · `nd!scan_names [apply] [avatars]` · `nd!mass-role <add|remove|status|cancel>` · `nd!add-money` · `nd!remove-money` · `nd!add-money-role` · `nd!remove-money-role` · `nd!reset-money` · `nd!leakdomain <add|remove|list>` · `nd!blacklist <add|remove|check|list>`\n' +
          '**Slash:** `/warn` · `/purge` · `/mod_automod` · `/ai_model` · `/macro` · `/case` · `/slowmode` · `/scan_names` · `/counters` (ServerStats-style stat channel names: add · remove · list · refresh)',
        inline: false,
      },
      {
        name: 'Server and profiles',
        value:
          '**Prefix:** `nd!serverinfo` · `nd!userinfo` · `nd!avatar`\n' +
          '**Slash:** `/serverinfo` · `/userinfo`',
        inline: false,
      },
      {
        name: 'Community',
        value:
          '**Prefix:** `nd!rank` · `nd!leaderboard` · `nd!afk` · `nd!poll` (reaction poll, emoji votes) · **native polls:** `nd!polls` / `nd!polls list` · `nd!polls create` · `nd!polls end` · `nd!polls pin` · `nd!polls stats` · `nd!announce` · `nd!reminder` · `nd!rolereact` · `nd!giveaway` · `nd!giveaway-end` · `nd!giveaway-list` · `nd!suggest` · `nd!approve` · `nd!deny` · `nd!suggestions` · `nd!schedule` · `nd!schedule-list` · `nd!schedule-cancel`\n' +
          '**Slash:** `/rank` · `/leaderboard` · `/afk` · `/polls` (list · create · end · pin · unpin · stats), native Discord polls in your configured Polls channel',
        inline: false,
      },
      {
        name: 'Roles',
        value:
          '**Self-assign:** `nd!roles` (list) · `nd!iam <role>` · `nd!iamnot <role>`\n' +
          '**Staff:** `nd!self-role <add|remove|list>` · `nd!auto-role <add|remove|list>` · `nd!rolereact`',
        inline: false,
      },
      {
        name: 'Fun',
        value:
          '**Prefix:** `nd!dad-joke` · `nd!truth` · `nd!dare` · `nd!tod` · `nd!nhie` · `nd!cat` · `nd!dog`',
        inline: false,
      },
      {
        name: 'Temp voice channels',
        value:
          '**Prefix (channel owner):** `nd!vc-limit` · `nd!vc-name` · `nd!vc-lock` · `nd!vc-unlock`: temporary voice channels from the lobby (no bot TTS/STT).',
        inline: false,
      },
      {
        name: 'Tickets',
        value:
          '**Panel:** pick a category → **Open Ticket** (private channel).\n' +
          '**Prefix:** `nd!ticket` · `nd!tickets` / `nd!ticket list` (= `/tickets`) · `nd!ticketstats` · `nd!ticketnote` · `nd!adduser` / `nd!removeuser` (inside a ticket)\n' +
          '**Slash:** `/ticket` · `/tickets` · `/ticketstats` · `/ticketnote`',
        inline: false,
      },
      {
        name: 'Safety and trust',
        value:
          '**Prefix:** `nd!safety` · `nd!scamtips` · `nd!privacy` · `nd!report` · `nd!reportuser @user <reason>` · `nd!automodpublic` · `nd!scamcheck` · `nd!tldr`\n' +
          '**Slash:** `/safety` · `/scamtips` · `/privacy` · `/report` · `/automod_public` · `/scam_check` · `/tldr`',
        inline: false,
      },
      {
        name: 'Warning',
        value:
          'We collect this data solely to improve your support experience. We do not sell your personal information, and we strive to keep our training sets focused on technical accuracy and product knowledge.',
        inline: false,
      },
      {
        name: 'Note',
        value:
          'By continuing to interact with the AI, you agree to help us make our tools better for the whole community.',
        inline: false,
      },
    )
}
