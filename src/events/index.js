import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { fail } from '../utils/embed.js';
import { isOnCooldown } from '../config.js';
export function registerEvents(client) {
  client.once(Events.ClientReady, c => logger.info(`Logged in as ${c.user.tag}`));
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return interaction.reply({ embeds: [fail('Unknown command.')], ephemeral: true });
    if (isOnCooldown(`${interaction.user.id}:${interaction.commandName}`)) return interaction.reply({ embeds: [fail('Slow down. Try again in a moment.')], ephemeral: true });
    try { await command.execute(interaction); } catch (error) { logger.error(`Command ${interaction.commandName} failed`, error); const response = { embeds: [fail('Something went wrong while running that command.')], ephemeral: true }; if (interaction.replied || interaction.deferred) await interaction.followUp(response); else await interaction.reply(response); }
  });
  client.on(Events.Error, error => logger.error('Discord client error', error));
}
