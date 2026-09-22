import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands } from './commands/index.js';
import { registerEvents } from './events/index.js';
import { database } from './database/index.js';
import { logger } from './utils/logger.js';
import { startHealthServer, setDiscordState } from './utils/health.js';

database.init();
startHealthServer();

// Validate configuration. If required secrets are missing we keep the process alive
// (health endpoint reports the problem) so hosting previews stay inspectable.
const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'OWNER_ID'];
const missing = required.filter(key => !process.env[key]);
const placeholder = process.env.DISCORD_TOKEN && /^(replace_|your_|YOUR_)/i.test(process.env.DISCORD_TOKEN.trim());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});
client.commands = new Collection();
await loadCommands(client);
registerEvents(client);

process.on('unhandledRejection', error => logger.error('Unhandled rejection', error));
process.on('uncaughtException', error => logger.error('Uncaught exception', error));

if (missing.length || placeholder) {
  const reason = missing.length ? `Missing required environment variables: ${missing.join(', ')}` : 'DISCORD_TOKEN is still a placeholder';
  logger.error(`${reason}. Set DISCORD_TOKEN, CLIENT_ID, and OWNER_ID in the environment, then restart. Health endpoint stays up meanwhile.`);
  setDiscordState(false, reason);
} else {
  if (!/^\d{17,20}$/.test(process.env.CLIENT_ID)) logger.warn('CLIENT_ID does not look like a Discord application ID; command registration may fail.');
  if (!/^\d{17,20}$/.test(process.env.OWNER_ID)) logger.warn('OWNER_ID does not look like a Discord user ID; owner commands may not work.');
  try {
    await client.login(process.env.DISCORD_TOKEN.trim());
    setDiscordState(true);
  } catch (error) {
    logger.error('Discord login failed. Reset the bot token in the Developer Portal and update DISCORD_TOKEN in the host environment.', error);
    setDiscordState(false, 'Discord login failed — check DISCORD_TOKEN');
    process.exitCode = 1;
  }
}
