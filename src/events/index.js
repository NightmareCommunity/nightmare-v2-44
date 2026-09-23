import { Events, ChannelType, PermissionFlagsBits, REST, Routes } from 'discord.js';
import { logger } from '../utils/logger.js';
import { fail, embed, ok } from '../utils/embed.js';
import { database, finishGiveaway, db } from '../database/index.js';
import { isOnCooldown } from '../config.js';
import { parseVouch } from '../utils/vouch.js';
import { panelSelectRow, buildFieldModal, fieldsForCategory, openTicketChannel, isStaffForTicket, ticketControlsRow, prioritySelect, closeTicket, reopenTicket } from '../utils/tickets.js';

export function registerEvents(client) {
  client.once(Events.ClientReady, async c => {
    logger.info(`Logged in as ${c.user.tag}`);
    // Auto-register slash commands on boot (idempotent PUT) so hosts that can only
    // run the main file (Pterodactyl panels like bot-hosting.net) stay up to date.
    try {
      if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN) {
        const { commands } = await import('../commands/index.js');
        await new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN.trim())
          .put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.map(cmd => cmd.data.toJSON()) });
        logger.info(`Auto-registered ${commands.length} global slash commands.`);
      }
    } catch (error) {
      logger.error('Auto-registration of slash commands failed (bot is still running)', error);
    }
    const tick = async () => {
      for (const row of database.activeGiveaways()) await finishGiveaway(client, row).catch(e => logger.error('Giveaway expiry failed', e));
      await autoCloseTick(client).catch(e => logger.error('Ticket auto-close failed', e));
    };
    tick().catch(e => logger.error('Startup tick failed', e));
    setInterval(() => tick().catch(e => logger.error('Tick failed', e)), 30000);
  });

  client.on(Events.InteractionCreate, async interaction => {
    try {
      // ---- Buttons ----
      if (interaction.isButton()) {
        if (isOnCooldown(`${interaction.user.id}:${interaction.customId}`, 1200)) return interaction.reply({ embeds: [fail('Please wait a moment.')], ephemeral: true });
        if (interaction.customId === 'giveaway:enter') {
          if (database.addGiveawayEntry(interaction.message.id, interaction.user.id)) return interaction.reply({ embeds: [ok('You entered the giveaway.')], ephemeral: true });
          return interaction.reply({ embeds: [fail('You are already entered, or this giveaway has ended.')], ephemeral: true });
        }
        if (interaction.customId === 'verification:verify') {
          const s = database.getSettings(interaction.guildId), role = interaction.guild.roles.cache.get(s.verification?.verifiedRole);
          if (!role) return interaction.reply({ embeds: [fail('Verification is not configured.')], ephemeral: true });
          if (s.verification.unverifiedRole) await interaction.member.roles.remove(s.verification.unverifiedRole).catch(() => {});
          await interaction.member.roles.add(role);
          return interaction.reply({ embeds: [ok('You are verified.')], ephemeral: true });
        }
        if (interaction.customId === 'ticket:claim') return handleClaim(interaction);
        if (interaction.customId === 'ticket:priority') return interaction.reply({ components: [prioritySelect()], ephemeral: true });
        if (interaction.customId === 'ticket:close') return handleCloseButton(interaction);
        if (interaction.customId === 'ticket:reopen') return handleReopenButton(interaction);
      }

      // ---- Select menus ----
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket:priority:set') {
          const ticket = database.ticketByChannel(interaction.channelId);
          if (!ticket) return interaction.reply({ embeds: [fail('Not a ticket channel.')], ephemeral: true });
          if (!isStaffForTicket(interaction.member, ticket)) return interaction.reply({ embeds: [fail('Staff only.')], ephemeral: true });
          database.updateTicket(interaction.channelId, { priority: interaction.values[0] });
          return interaction.update({ embeds: [ok(`Priority set to **${interaction.values[0]}**.`)], components: [] });
        }
        if (interaction.customId.startsWith('ticket:pick:')) return handlePanelPick(interaction);
      }

      // ---- Modals ----
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('ticket:open:')) return handleTicketModal(interaction);
        if (interaction.customId === 'ticket:close:reason') return handleCloseReasonSubmit(interaction);
      }

      if (!interaction.isChatInputCommand()) return;
      const command = client.commands.get(interaction.commandName);
      if (!command) return interaction.reply({ embeds: [fail('Unknown command.')], ephemeral: true });
      await command.execute(interaction);
    } catch (error) {
      logger.error('Interaction failed', error);
      const response = { embeds: [fail('Something went wrong while handling that interaction.')], ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    }
  });

  client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild) return;
    const s = database.getSettings(message.guild.id);

    // +rep / vouch parsing — works everywhere in the server
    if (/^(\+rep|vouch)\s/i.test(message.content)) {
      const parsed = parseVouch(message.content, message.author.id);
      if (parsed.ok) {
        const target = await message.guild.members.fetch(parsed.targetId).catch(() => null);
        if (!target) return;
        const id = database.addVouch(message.guild.id, parsed.targetId, message.author.id, parsed.description);
        await message.react('⭐').catch(() => {});
        await message.reply({ embeds: [embed(`Vouch recorded (#${id})`, `<@${parsed.targetId}> now has **${database.vouchCounter(parsed.targetId)?.total ?? 1}** vouches.\n> ${parsed.description}`)] }).catch(() => {});
        if (s.vouchchannel) {
          const logChannel = message.guild.channels.cache.get(s.vouchchannel);
          if (logChannel) logChannel.send({ embeds: [embed('New vouch', `<@${message.author.id}> vouched <@${parsed.targetId}> (vouch **#${id}**)\n> ${parsed.description}`)] }).catch(() => {});
        }
        return;
      }
      if (parsed.error === 'self') { await message.reply('You cannot vouch for yourself. 🙃').then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {}); return; }
      if (parsed.error === 'format') { await message.reply('Format: `+rep @user description of the deal`').then(m => setTimeout(() => m.delete().catch(() => {}), 8000)).catch(() => {}); return; }
    }

    // Automod (invite links when enabled)
    if (s.automod === true && /(discord\.gg\/|discord\.com\/invite|@everyone|@here)/i.test(message.content)) {
      await message.delete().catch(() => {});
      const log = message.guild.channels.cache.get(s.logs);
      if (log) log.send(`Automod removed a message from ${message.author} in ${message.channel}.`).catch(() => {});
    }
  });

  client.on(Events.GuildMemberAdd, async member => {
    const s = database.getSettings(member.guild.id);
    if (s.autorole) await member.roles.add(s.autorole).catch(e => logger.error('Autorole failed', e));
    if (s.verification?.unverifiedRole) await member.roles.add(s.verification.unverifiedRole).catch(() => {});
    if (s.welcome) {
      const c = member.guild.channels.cache.get(s.welcome);
      if (c) await c.send(`Welcome ${member} to **${member.guild.name}**!`).catch(() => {});
    }
  });

  client.on(Events.GuildMemberRemove, async member => {
    const s = database.getSettings(member.guild.id), c = member.guild.channels.cache.get(s.goodbye);
    if (c) await c.send(`**${member.user?.tag || 'A member'}** left the server.`).catch(() => {});
  });

  client.on(Events.Error, error => logger.error('Discord client error', error));
}

// ---- Panel pick -> send modal with configured fields ----
async function handlePanelPick(interaction) {
  const categoryId = Number(interaction.values[0]);
  const category = database.categoryById(categoryId);
  if (!category || category.disabled) return interaction.reply({ embeds: [fail('That category is not available.')], ephemeral: true });
  const settings = database.getSettings(interaction.guildId);
  if ((settings.ticketBlacklist || []).includes(interaction.user.id)) return interaction.reply({ embeds: [fail('You are blacklisted from opening tickets in this server.')], ephemeral: true });
  if (category.open_limit_per_user && database.openTicketCount(interaction.guildId, interaction.user.id, category.id) >= category.open_limit_per_user) {
    return interaction.reply({ embeds: [fail(`You already have **${category.open_limit_per_user}** open ${category.label} ticket(s).`)], ephemeral: true });
  }
  const fields = fieldsForCategory(category.id);
  if (!fields.length) {
    // No form configured — open immediately
    await interaction.deferReply({ ephemeral: true });
    const { channel } = await openTicketChannel(interaction, category, new Map());
    return interaction.editReply({ embeds: [ok(`Ticket created: ${channel}`)] });
  }
  return interaction.showModal(buildFieldModal(category, fields));
}

// ---- Modal submit -> validate -> open ticket channel with formatted responses ----
async function handleTicketModal(interaction) {
  const categoryId = Number(interaction.customId.split(':')[2]);
  const category = database.categoryById(categoryId);
  if (!category) return interaction.reply({ embeds: [fail('Category no longer exists.')], ephemeral: true });
  const fields = fieldsForCategory(category.id);
  const responses = new Map();
  for (const field of fields.slice(0, 5)) {
    const value = interaction.fields.getTextInputValue(`field:${field.id}`);
    if (value) responses.set(String(field.id), value);
  }
  // Choice validation (exact match, case-insensitive)
  for (const field of fields) {
    if (!field.choices) continue;
    const allowed = JSON.parse(field.choices).map(c => String(c).toLowerCase());
    const value = responses.get(String(field.id));
    if (value && !allowed.includes(value.toLowerCase())) {
      return interaction.reply({ embeds: [fail(`**${field.label}** must be one of: ${allowed.join(', ')}`)], ephemeral: true });
    }
  }
  await interaction.deferReply({ ephemeral: true });
  const { channel } = await openTicketChannel(interaction, category, responses);
  await interaction.editReply({ embeds: [ok(`Ticket created: ${channel}`)] });
}

// ---- Ticket buttons ----
async function handleClaim(interaction) {
  const ticket = database.ticketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], ephemeral: true });
  if (!isStaffForTicket(interaction.member, ticket)) return interaction.reply({ embeds: [fail('Staff only.')], ephemeral: true });
  if (ticket.claimed_by) return interaction.reply({ embeds: [fail(`Already claimed by <@${ticket.claimed_by}>.`)], ephemeral: true });
  database.updateTicket(interaction.channelId, { claimed_by: interaction.user.id, status: 'claimed', claimed_at: Date.now() });
  return interaction.reply({ embeds: [ok(`${interaction.user} claimed this ticket.`)] });
}

async function handleCloseButton(interaction) {
  const ticket = database.ticketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], ephemeral: true });
  if (!isStaffForTicket(interaction.member, ticket) && ticket.creator_id !== interaction.user.id) {
    return interaction.reply({ embeds: [fail('Only staff or the ticket owner can close.')], ephemeral: true });
  }
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
  const modal = new ModalBuilder().setCustomId('ticket:close:reason').setTitle('Close ticket')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
    ));
  return interaction.showModal(modal);
}

async function handleReopenButton(interaction) {
  const ticket = database.ticketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], ephemeral: true });
  if (!isStaffForTicket(interaction.member, ticket) && ticket.creator_id !== interaction.user.id) {
    return interaction.reply({ embeds: [fail('Only staff or the ticket owner can reopen.')], ephemeral: true });
  }
  await reopenTicket(interaction.channel, ticket);
  return interaction.reply({ embeds: [ok('Ticket reopened.')], ephemeral: true });
}

// ---- Modal for close reason (registered in the same interaction handler) ----
export function isCloseReasonModal(customId) { return customId === 'ticket:close:reason'; }

export async function handleCloseReasonSubmit(interaction) {
  const ticket = database.ticketByChannel(interaction.channelId);
  if (!ticket) return interaction.reply({ embeds: [fail('This is not a ticket channel.')], ephemeral: true });
  await interaction.deferReply();
  const reason = interaction.fields.getTextInputValue('reason') || 'No reason provided';
  await closeTicket(interaction.client, interaction.channel, ticket, reason, interaction.user.id);
  return interaction.followUp({ embeds: [ok('Ticket closed. Transcript saved and DM\u2019d to the owner if their DMs are open.')] });
}

// ---- Auto-close worker ----
async function autoCloseTick(client) {    const guilds = [...new Set(db.prepare("SELECT DISTINCT guild_id FROM tickets WHERE status IN ('open','claimed')").all().map(r => r.guild_id))];
  for (const guildId of guilds) {
    const s = database.getSettings(guildId);
    const closeHours = s.autoCloseHours ?? 48;
    const warnHours = s.autoCloseWarnHours ?? 24;
    const now = Date.now();
    const rows = db.prepare("SELECT * FROM tickets WHERE guild_id=? AND status IN ('open','claimed') AND last_activity_at < ?").all(guildId, now - closeHours * 3600 * 1000);
    for (const ticket of rows) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) { database.updateTicket(ticket.channel_id, { status: 'closed', closed_at: now, close_reason: 'Auto-closed (channel missing)' }); continue; }
      await closeTicket(client, channel, ticket, 'Auto-closed due to inactivity', client.user.id).catch(e => logger.error('Auto-close failed', e));
    }
    const warnRows = db.prepare("SELECT * FROM tickets WHERE guild_id=? AND status IN ('open','claimed') AND last_activity_at < ? AND last_warned_at IS NULL").all(guildId, now - warnHours * 3600 * 1000);
    for (const ticket of warnRows) {
      const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
      if (!channel) continue;
      database.updateTicket(ticket.channel_id, { last_warned_at: now });
      await channel.send({ embeds: [embed('⚠️ Inactivity warning', `This ticket will be **auto-closed** if there is no activity for **${closeHours - warnHours}** more hour(s).`)] }).catch(() => {});
    }
  }
}
