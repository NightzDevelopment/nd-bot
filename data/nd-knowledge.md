# Nightz Development (ND) knowledge base

Edit this file with your real information. It is appended to the AI system prompt when `ND_KEYWORDS_FILE` points here.

## Brand and positioning

- **Nightz Development (ND)** sells and supports FiveM scripts and resources.
- **Tagline (example):** Optimized, innovative FiveM resources, built by developers who care about performance and community.
- **Support stance:** Point users to the **store**, the **docs site**, README files inside each resource, pinned FAQ, and ticket channels (in-Discord ticket panel, or the external desk for store/account issues).
- **New store note:** ND moved to a brand new store platform. The store is still in **alpha/beta**; if a user hits a bug there, point them to the desk (live support bot + ticketing) rather than assuming it is user error.

## Official links

- **Main site / store:** `https://shop.nightz.dev/`
- **Premium membership:** `https://shop.nightz.dev/premium`
- **Roadmap:** `https://shop.nightz.dev/roadmap`
- **Changelog (store/website):** `https://shop.nightz.dev/changelog`
- **Support desk (live support bot + external ticketing, store/account issues):** `https://desk.nightz.dev/`
- **Feedback board:** `https://feedback.nightz.dev/`
- **Apply / programs (Affiliate, Partner, Content Creator, Beta Tester, Custom Script Request, Developer/Integration, Report a Bug, Join the Team):** `https://forms.nightz.dev/`
- **Documentation:** `https://docs.nightz.dev/` (getting started guide for the ND Framework Suite; still being built out)
- **Discord invite:** `https://discord.gg/KaKCBUkD8M`
- **Changelog / updates (in Discord):** Posted in the Discord channel <#1477283391757090906> (product updates / announcements), in addition to the web changelog above.

## Getting your keys on the new store

- Click your name (top right) -> **Account** -> **Licenses and Purchases** -> **Purchases & downloads**.
- If a key or purchase is missing, open a ticket via the in-Discord ticket panel or the desk (`https://desk.nightz.dev/`) rather than guessing.

## Products (examples: replace with your live catalog)

For each product, keep one short block the bot can cite.

### ND_DiscordUnified

- **What it is:** Discord integration for FiveM (modules under `config/modules/`, optional extensions).
- **Typical deps:** ox_lib, oxmysql (as per your resource).
- **Install (generic):** Add resource folder to server, ensure dependencies, `ensure ND_DiscordUnified` in `server.cfg`.
- **Where to configure:** `config/modules/` (e.g. `automod.lua`, `notifications.lua`, `welcome.lua`, `moderation.lua`).

### ND_Scenes (example)

- **What it is:** Scene / staging utility for servers (adjust to your real description).
- **Notes:** Replace with real requirements and compatibility (ESX / QBCore / standalone).

### ND_AFKV3 (example)

- **What it is:** AFK detection / rewards (adjust to your real description).

## Policies (replace with your real policies)

- **Licensing:** Summarize Tebex / key activation, server limits, and redistribution rules in plain language.
- **Refunds:** State whether refunds are handled via Tebex support or tickets only.
- **Transfers:** Explain if license transfers between servers/accounts are allowed and how.
- **Internal / unreleased:** ND_Menu, ND_Framework, and other unreleased resources are not public; do not promise features or release dates.

## Discord layout

- **Rules / FAQ:** `#rules-faq` or pinned rules channel.
- **Tech support:** `#tech-support`
- **Tickets:** Use the server ticket panel or `#open-a-ticket` (match your server).
- **Changelog / product updates:** <#1477283391757090906>

## Roles (examples)

- **Staff / Developer / Support:** Describe what users should expect from each role (no real names required).

## Common troubleshooting (short bullets)

- **SCRIPT ERROR in F8:** Ask for the full line (file path + line number) and framework version.
- **Database / SQL:** Mention oxmysql / mysql-async and that migrations must run if your product ships SQL.
- **Artifacts / build:** Outdated FiveM server artifacts can cause odd client issues; suggest updating server build.
- **OneSync / entity limits:** Large populations may need tuning; avoid promising exact numbers without context.

## What the bot must not do

- Do not invent product names or Tebex URLs; use this file, FAQ pins, indexed dev files, and `data/products/*.md` only.
- Do not paste full source files in Discord; reference filenames and settings only.
