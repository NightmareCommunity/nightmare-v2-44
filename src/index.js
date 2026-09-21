import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands } from './commands/index.js';
import { registerEvents } from './events/index.js';
import { database } from './database/index.js';
import { logger } from './utils/logger.js';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'OWNER_ID'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
if (!/^\d{17,20}$/.test(process.env.CLIENT_ID)) throw new Error('CLIENT_ID must be a Discord application ID');
if (!/^\d{17,20}$/.test(process.env.OWNER_ID)) throw new Error('OWNER_ID must be a Discord user ID');
if (/^(replace_|your_|YOUR_)/i.test(process.env.DISCORD_TOKEN.trim())) throw new Error('DISCORD_TOKEN is still a placeholder');

database.init();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});
client.commands = new Collection();
await loadCommands(client);
registerEvents(client);
process.on('unhandledRejection', error => logger.error('Unhandled rejection', error));
process.on('uncaughtException', error => logger.error('Uncaught exception', error));
try { await client.login(process.env.DISCORD_TOKEN.trim()); } catch (error) { logger.error('Discord login failed. Reset the bot token in the Developer Portal and update DISCORD_TOKEN in the host environment.', error); process.exitCode = 1; }
