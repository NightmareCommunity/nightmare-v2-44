import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands } from './commands/index.js';
import { registerEvents } from './events/index.js';
import { database } from './database/index.js';
import { logger } from './utils/logger.js';

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'OWNER_ID'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);

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
await client.login(process.env.DISCORD_TOKEN);
