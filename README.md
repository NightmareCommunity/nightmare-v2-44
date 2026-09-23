# NIGHTMARE V2.44

Production Discord bot (discord.js v14 + SQLite) focused on four things: **seller vouches**, **ticket panels with modal forms**, **saved crypto/UPI payout addresses**, and **full server moderation**.

## Features

### ⭐ Vouch / rep system (seller reputation)
- Type `+rep @user description` (or `vouch @user description`) in any channel — the bot reacts ⭐, confirms with the seller's live vouch count, and stores it permanently
- Self-vouching blocked; 2-minute duplicate window per author→target pair
- `/vouch view @user` — paged vouch history with IDs
- `/vouch me` — your vouches plus total + this-month counters
- `/vouch top` — server leaderboard
- `/vouch latest` — newest vouches server-wide
- `/vouch remove <id>` — authors, targets, or moderators can remove (audited)
- `/config vouchchannel` — mirror every new vouch into a dedicated channel

### 🎫 Ticket panels with modal forms
- `/ticketpanel create` — posts a panel with a category dropdown
- `/ticketcategory add` — per category: staff roles (up to 3), destination channel category, ticket-name format (`{username}`), open-ticket limit per user
- `/ticketfield add` — up to 5 modal questions per category (Discord limit): short text or paragraph, required/optional, placeholder, exact-match choice validation (e.g. `LTC, UPI` dropdown-style answers)
- Opening a ticket runs the form modal → a private channel is created (owner + category staff roles only) with the responses posted as a formatted embed
- In-ticket controls (buttons): **Claim**, **Priority** (low/normal/high/critical), **Close** (with reason modal) — plus `/ticket reopen|unclaim|add|remove|transcript|delete`
- `/ticket blacklist|unblacklist` — block abusive users from opening tickets
- Auto-close worker: warns after N idle hours (default 24), closes after N more (default 48) — configurable via `/config autoclose`
- HTML transcript generated on close (paginated message history), DM'd to the owner and served at `/transcripts/ticket-<id>.html`

### 💳 Payout address vault (private per user)
- `/payout save type:<ltc|upi|bank> address:<...>` — each user's methods are visible only to them (ephemeral replies)
- **LTC addresses are fully checksum-verified**: bech32 (`ltc1…`) via a BIP-173 implementation validated against official test vectors, and legacy `L…`/`M…` via real base58check double-SHA256 validation
- **UPI IDs** validated as `name@bank` VPAs (normalized to lowercase)
- Private-key-shaped input is detected and rejected with an explicit warning — the bot never accepts seed phrases or private keys
- `/payout list|remove|default` — manage methods, one marked default
- `/payout confirm` — two-step confirmation (token valid 10 minutes) to protect accounts; unconfirmed methods are flagged ⚠️
- Every save/change is written to the audit log (`moderation_logs`)

### 🛡️ Full moderation
- `/ban /unban /softban /kick` with reasons + optional evidence links, role-hierarchy guarded
- `/timeout /untimeout` (up to 28 days), `/warn` (DMs the user), `/warnings`
- `/history @user` — numbered case history; `/case view|reason` — view or edit any case
- `/clear` (bulk delete), `/slowmode`, `/lock /unlock`
- `/nick`, `/role`, `/removerole`
- Persistent numbered cases with moderator, reason, evidence, timestamps; all changes audited
- Basic automod toggle (invite links + mass pings) via `/config automod`

### Also included
- Welcome/goodbye channels, autorole, button verification (`/config`, `/verification setup`)
- Giveaways with entries, winners, reroll (`/giveaway start|end|reroll|list`)
- `/ping /help /serverinfo /userinfo`, owner tools (`/owner status|servers|reload`)
- Health endpoint on `PORT` (`/health`) so hosting platforms can verify readiness

## Deploying to bot-hosting.net

No credit card needed — the host bills a free coin system.

1. **Claim coins:** log in at [bot-hosting.net](https://bot-hosting.net/login) with Discord → **Earn Coins** → claim the free coins (10/day via the free generator; a free-tier server costs a small weekly amount of coins).
2. **Create the server:** **Create Server** → name it, language **Node.js** → pick the cheapest plan that fits (this bot is light — the smallest works; bump RAM/CPU later if needed) → weekly billing.
3. **Upload the code:** panel → **Files** → **Upload** a zip of the repo (Code → Download ZIP on GitHub; exclude `node_modules` — the host auto-installs from `package.json`). Unarchive, then move contents up one level (`..`).
4. **Startup tab:**
   - **Bot JS file:** `src/index.js`
   - **Additional Node.js packages:** leave empty (auto-installed from `package.json`)
   - **Variables:** add `DISCORD_TOKEN`, `CLIENT_ID`, `OWNER_ID` with your values (Pterodactyl user variables — put them here, not in a `.env` file)
5. **Start.** First boot auto-installs dependencies and auto-registers slash commands (built into `Events.ClientReady`), so no manual `npm run register` is needed.
6. Health check: open the panel's **Network** tab, note the primary allocation port, and hit `http://<server-ip>:<port>/health` — should return `"discord": true`.

Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal → Bot → Privileged Intents, or the process will crash-loop at login.

## Quick start

```bash
bun install        # or npm install
npm run check      # syntax-check every source file
npm run smoke      # run the 25-check smoke suite (DB, parser, validators, builders)
npm run register   # register slash commands with Discord (needs token)
npm start          # start the bot + health server
```

Required environment: `DISCORD_TOKEN`, `CLIENT_ID`, `OWNER_ID`. Optional: `DATABASE_PATH` (default `./data/nightmare.sqlite`), `PORT` (default 3000).

Enable **Server Members Intent** and **Message Content Intent** in the Discord Developer Portal.

## Typical server setup

1. `/config welcome #welcome`, `/config logs #mod-log`, `/config autorole @Member`
2. `/ticketpanel create title:"Support"` in your ticket hub channel
3. `/ticketcategory add key:support label:"General Support" staff_role_1:@Staff`
4. `/ticketfield add category_key:support label:"Describe your issue" style:paragraph required:true`
5. Sellers run `/payout save` once; buyers vouch with `+rep @seller deal went great, fast delivery`

## Data & privacy
- SQLite (WAL mode) at `data/nightmare.sqlite`; transcripts in `data/transcripts/`
- Payout rows are per-user and only ever rendered in ephemeral messages
- `/transcripts/<file>.html` traversal is blocked (basename-only resolution)

## Structure
- `src/index.js` — bootstrap, intents, health server
- `src/commands/index.js` — moderation, vouch, payout, ticket, config, core commands
- `src/commands/legacy.js` — giveaways, verification panel, owner tools
- `src/events/index.js` — interaction router (buttons/selects/modals), `+rep` parser, auto-close worker
- `src/database/index.js` — schema + all queries (vouches, tickets, payouts, cases, audit)
- `src/utils/` — `tickets.js` (engine), `validate.js` (LTC/UPI), `vouch.js`, `embed.js`, `health.js`, `logger.js`
- `scripts/smoke.mjs` — test suite (`npm run smoke`)
