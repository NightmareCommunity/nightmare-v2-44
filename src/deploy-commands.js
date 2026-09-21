import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID are required');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.map(c => c.data.toJSON()) });
console.log(`Registered ${commands.length} global commands.`);
