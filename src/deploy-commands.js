import 'dotenv/config';
import { REST, Routes } from 'discord.js';
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) throw new Error('DISCORD_TOKEN and CLIENT_ID are required');
if (/^(replace_|your_|YOUR_)/i.test(process.env.DISCORD_TOKEN.trim())) throw new Error('DISCORD_TOKEN is still a placeholder');
const { commands } = await import('./commands/index.js');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN.trim());
try { await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.map(c => c.data.toJSON()) }); console.log(`Registered ${commands.length} global commands.`); } catch (error) { console.error('Slash-command registration failed. Check the token, Client ID, and application ownership.', error); process.exitCode = 1; }
