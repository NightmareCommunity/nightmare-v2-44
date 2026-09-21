# NIGHTMARE V2.44

A modular Discord.js v14 moderation and community bot with SQLite persistence, centralized embeds, permission gates, role hierarchy checks, cooldown-ready event handling, and environment-only secrets.

## Implemented
- Core: `/ping`, `/help`, `/serverinfo`, `/userinfo`, `/avatar`
- Moderation: `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/softban`, `/clear`, `/slowmode`, `/lock`, `/unlock`, `/nick`, `/role`, `/removerole`, `/warn`, `/warnings`
- Persistent moderation cases, warnings, guild settings, tickets, and giveaways (including entries and winner state)
- Typed admin-gated `/config view`, `/config welcome`, `/config goodbye`, `/config logs`, `/config moderation`, `/config automod`, `/config tickets`, `/config verification`, and `/config autorole`
- Ticket panel via `/tickets setup`, button-based ticket creation, and `/tickets close|claim|add|remove`
- Welcome, goodbye, autorole, automod, and basic logging seams through Discord events
- Owner-only `/owner status|servers|reload|broadcast|shutdown` gate using `OWNER_ID`, with safe broadcast/shutdown semantics
- Global interaction error handling and no secrets in source

## Current limitations
Giveaways persist entries and use a safe 30-second expiry worker; the worker only ends persisted giveaways and never shuts down the process. `/owner broadcast` intentionally requires a separate controlled confirmation and sends nothing by itself; `/owner shutdown` is disabled for safety. Configure channels and roles through the typed `/config` subcommands, and ensure the bot role is high enough. The bot does not invent defaults or external integrations.

## Requirements and setup
Node.js 20+, a Discord application, and a bot token. Copy `.env.example` to `.env`, provide `DISCORD_TOKEN`, `CLIENT_ID`, and `OWNER_ID`, then run:

```bash
npm install
npm run check
npm run register
npm start
```

Enable Server Members and Message Content intents. Keep `.env` and the SQLite database private. `DATABASE_PATH` defaults to `./data/nightmare.sqlite`.

## Security
The token is never stored in source. Rotate any token exposed in chat or source control. Discord permission gates and role hierarchy checks protect moderation operations; the bot cannot manage roles above its highest role. Grant only required OAuth2 permissions.

## Structure
`src/index.js` bootstraps the client; `src/commands/index.js` contains slash command definitions; `src/events/index.js` handles commands, buttons, and event seams; `src/database/index.js` owns SQLite schema/helpers; `src/utils/` contains embeds and logging.
