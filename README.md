# NIGHTMARE V2.44

A secure, modular Discord.js v14 bot foundation with dark/nightmare branding, slash commands, SQLite persistence, centralized embeds, cooldowns, permission gates, and resilient interaction error handling.

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
1. Create an application at https://discord.com/developers/applications.
2. Copy the Application ID to `CLIENT_ID`.
3. Reset/copy the bot token into `DISCORD_TOKEN`.
4. Enable **Server Members Intent**, **Message Content Intent**, and **Presence Intent only if later needed**.
5. Use OAuth2 URL Generator with `bot` and `applications.commands`; grant only permissions required by enabled modules.

## Environment variables
| Variable | Required | Purpose |
|---|---:|---|
| `DISCORD_TOKEN` | yes | Bot secret |
| `CLIENT_ID` | yes | Application ID |
| `OWNER_ID` | yes | Reserved for future owner-only modules |
| `DATABASE_PATH` | no | SQLite file location |
| `NODE_ENV` | no | Runtime mode |

## Deployment
Any free Node.js host that supports long-running processes can run this bot, subject to its sleep/runtime limits. Examples include a free-tier VM or a self-hosted machine. Discord bots need a continuously running process; hosts that sleep inactive services may disconnect the bot. Do not claim unlimited uptime from a free tier.

Run `npm run register` after command changes, then `npm start`. For production, use the host's process manager and persistent disk for SQLite. If the host has ephemeral storage, use a persistent volume or the warning database will be lost on restart.

## Security and operations
- Never expose `DISCORD_TOKEN` or commit `.env`.
- The supplied credential in chat should be treated as compromised: revoke/rotate it in the Discord Developer Portal before using this project. It was not written to project files.
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
README.md
```
