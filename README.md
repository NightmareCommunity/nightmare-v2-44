# NIGHTMARE V2.44

A secure, modular Discord.js v14 bot foundation with dark/nightmare branding, slash commands, SQLite persistence, centralized embeds, cooldowns, permission gates, and resilient interaction error handling.

## Important token security
The token previously pasted into chat is exposed and must be revoked immediately in the Discord Developer Portal. Do not put it in GitHub or send it in chat. Generate a replacement under **Developer Portal → Application → Bot → Reset Token**, then set the replacement only in your hosting provider's environment variables as `DISCORD_TOKEN`.

## Implemented in this release
- `/ping`, `/help`, `/serverinfo`, `/userinfo`, `/avatar`
- `/config` (administrator-only settings inspection)
- `/warn`, `/warnings` with persistent SQLite warning history
- Automatic database initialization
- Global slash-command registration
- Modular command/event/database/utils structure
- Environment-based secrets; no token is stored in source

The requested moderation, automod, tickets, giveaways, welcome, verification, logging, autorole, role menus, statistics, and owner command suites are **not claimed as implemented in this release**. Their database/module seams can be added without replacing the core architecture.

## Requirements
- Node.js 20+
- A Discord application and bot token
- SQLite is local and free; no paid APIs or external services are required.

## Install
```bash
cp .env.example .env
npm install
npm run check
npm run register
npm start
```

Keep `.env` private and never commit it. `DATABASE_PATH` defaults to `./data/nightmare.sqlite`; create backups of this file in production.

## Developer Portal setup
1. Create/open the application at https://discord.com/developers/applications.
2. Copy the Application ID to `CLIENT_ID`.
3. Under **Bot**, reset the token and add the replacement only to the host environment as `DISCORD_TOKEN`.
4. Enable **Server Members Intent** and **Message Content Intent**. Presence is not requested.
5. Use OAuth2 URL Generator with scopes `bot` and `applications.commands`; grant only permissions required by enabled modules.

## Environment variables
| Variable | Required | Purpose |
|---|---:|---|
| `DISCORD_TOKEN` | yes | Bot secret; never commit it |
| `CLIENT_ID` | yes | Application ID |
| `OWNER_ID` | yes | Reserved for future owner-only modules |
| `DATABASE_PATH` | no | SQLite file location |
| `NODE_ENV` | no | Runtime mode |

## Deployment
Any free Node.js host that supports long-running processes can run this bot, subject to its sleep/runtime limits. Discord bots need a continuously running process; hosts that sleep inactive services may disconnect the bot. Do not claim unlimited uptime from a free tier.

Run `npm run register` after command changes, then `npm start`. Global commands can take up to an hour to appear. If the host has ephemeral storage, use a persistent volume or the warning database will be lost on restart.

## Security and operations
- Never expose `DISCORD_TOKEN` or commit `.env`.
- Rotate any token pasted into chat or source control.
- Use least-privilege bot permissions.
- Keep the bot role below roles it must not moderate.
- Inspect logs and back up SQLite.
- Command errors are isolated and returned as ephemeral messages; process-level handlers log unexpected failures.

## Structure
```text
src/
  index.js              # client bootstrap and intents
  deploy-commands.js    # slash command registration
  config.js             # branding and cooldown policy
  commands/index.js     # command modules
  events/index.js       # ready, interactions, API errors
  database/index.js     # SQLite schema and settings helpers
  utils/embed.js        # consistent NIGHTMARE embeds
  utils/logger.js       # centralized logger
.env.example
.gitignore
README.md
```
