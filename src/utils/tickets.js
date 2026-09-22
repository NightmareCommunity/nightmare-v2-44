// Ticket engine: panel select menus, modal forms, claim/priority/close/reopen, HTML transcripts.
import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { database } from '../database/index.js';
import { COLORS, BRAND } from '../config.js';

const STYLE_MAP = { short: TextInputStyle.Short, paragraph: TextInputStyle.Paragraph };

export function ticketControlsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Success),
    new ButtonStringHelper('ticket:priority'),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Danger)
  );
}

// Button that opens the priority select menu
function ButtonStringHelper(customId) {
  return new ButtonBuilder().setCustomId(customId).setLabel('Priority').setStyle(ButtonStyle.Secondary);
}

export function prioritySelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('ticket:priority:set').setPlaceholder('Set ticket priority')
      .addOptions([
        { label: 'Low', value: 'low' },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
        { label: 'Critical', value: 'critical' },
      ])
  );
}

export function panelSelectRow(panelId, categories) {
  const menu = new StringSelectMenuBuilder().setCustomId(`ticket:pick:${panelId ?? 'pending'}`).setPlaceholder('Open a ticket — choose a category');
  if (!categories?.length) {
    menu.addOptions({ label: 'No categories yet', value: 'none', description: 'Admins: add categories with /ticketcategory add' });
    menu.setDisabled(true);
  } else {
    for (const c of categories.slice(0, 25)) {
      menu.addOptions({ label: c.label.slice(0, 100), value: String(c.id), description: (c.description || `Open a ${c.label} ticket`).slice(0, 100) });
    }
  }
  return new ActionRowBuilder().addComponents(menu);
}

export function buildFieldModal(category, fields) {
  const modal = new ModalBuilder().setCustomId(`ticket:open:${category.id}`).setTitle(category.label.slice(0, 45));
  const usable = fields.slice(0, 5);
  for (const field of usable) {
    const input = new TextInputComponentHelper(`field:${field.id}`, field);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

function TextInputComponentHelper(customId, field) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(field.label.slice(0, 45))
    .setStyle(STYLE_MAP[field.style] ?? TextInputStyle.Short)
    .setRequired(Boolean(field.required));
  if (field.placeholder) input.setPlaceholder(String(field.placeholder).slice(0, 100));
  if (field.min_length) input.setMinLength(Math.max(1, field.min_length));
  if (field.max_length) input.setMaxLength(Math.min(4000, field.max_length));
  return input;
}

export function fieldsForCategory(categoryId) {
  return database.db.prepare('SELECT * FROM ticket_form_fields WHERE category_id=? ORDER BY position, id').all(categoryId);
}

export function formatFormResponses(fields, values) {
  return fields.map((field) => {
    const value = values.get(String(field.id)) || values.get(`field:${field.id}`) || '—';
    return `**${field.label}:** ${value}`;
  }).join('\n');
}

export function isStaffForTicket(member, ticket) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  if (!ticket.category_id) {
    const settings = database.getSettings(ticket.guild_id);
    return Boolean(settings.tickets && member.roles.cache.has(settings.tickets));
  }
  const category = database.db.prepare('SELECT staff_roles FROM ticket_categories WHERE id=?').get(ticket.category_id);
  if (!category) return false;
  const roleIds = JSON.parse(category.staff_roles || '[]');
  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

export async function openTicketChannel(interaction, category, responses) {
  const guild = interaction.guild;
  const staffRoleIds = JSON.parse(category.staff_roles || '[]');
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [...allow] },
  ];
  for (const roleId of staffRoleIds) overwrites.push({ id: roleId, allow: [...allow] });
  const name = (category.ticket_name_format || 'ticket-{username}')
    .replace('{username}', interaction.user.username).replace('{id}', String(category.id)).slice(0, 100);
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.parent_category_id || undefined,
    permissionOverwrites: overwrites,
  });
  const ticketId = database.createTicket(guild.id, category.panel_id, category.id, channel.id, interaction.user.id);
  const fields = fieldsForCategory(category.id);
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`${category.label} — Ticket #${ticketId}`)
    .setDescription((formatFormResponses(fields, responses) || 'No form responses.').slice(0, 4000))
    .addFields({ name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true })
    .setFooter({ text: BRAND })
    .setTimestamp();
  await channel.send({ content: `${interaction.user} ${staffRoleIds.map(r => `<@&${r}>`).join(' ')}`.trim(), embeds: [embed], components: [ticketControlsRow()] });
  return { channel, ticketId };
}

export async function closeTicket(client, channel, ticket, reason, closedById) {
  const transcriptPath = await saveTranscript(channel, ticket).catch(() => null);
  const record = { ...ticket, status: 'closed', close_reason: reason, closed_at: Date.now(), closed_by: closedById };
  database.updateTicket(channel.id, { status: 'closed', close_reason: reason, closed_at: Date.now() });
  const file = transcriptPath ? { attachment: transcriptPath, name: path.basename(transcriptPath) } : null;
  const embed = new EmbedBuilder().setColor(COLORS.danger).setTitle(`Ticket #${ticket.id} closed`)
    .setDescription(`Closed by <@${closedById}>\nReason: ${reason}`).setFooter({ text: BRAND }).setTimestamp();
  await channel.send({ embeds: [embed], files: file ? [file] : [] }).catch(() => {});
  // DM the transcript to the ticket owner
  if (transcriptPath) {
    const owner = await client.users.fetch(ticket.creator_id).catch(() => null);
    if (owner) {
      await owner.send({ embeds: [embed(`Your ticket in ${channel.guild?.name || 'the server'} was closed`, `Reason: ${reason}`)], files: [{ attachment: transcriptPath, name: path.basename(transcriptPath) }] }).catch(() => {});
    }
  }
  return record;
}

export async function reopenTicket(channel, ticket) {
  database.updateTicket(channel.id, { status: 'open', closed_at: null, close_reason: null, last_activity_at: Date.now() });
  const embed = new EmbedBuilder().setColor(COLORS.success).setTitle(`Ticket #${ticket.id} reopened`).setFooter({ text: BRAND }).setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
  await channel.permissionOverwrites.edit(ticket.creator_id, { SendMessages: true }).catch(() => {});
}

export async function saveTranscript(channel, ticket) {
  const dir = path.join('data', 'transcripts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ticket-${ticket.id}.html`);
  const messages = await fetchAllMessages(channel);
  const html = renderTranscriptHtml(channel, ticket, messages);
  fs.writeFileSync(file, html);
  return file;
}

async function fetchAllMessages(channel) {
  const collected = [];
  let beforeId;
  for (let i = 0; i < 50; i++) {
    const options = { limit: 100 };
    if (beforeId) options.before = beforeId;
    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch || !batch.size) break;
    collected.push(...batch.values());
    beforeId = batch.last().id;
    if (batch.size < 100) break;
  }
  return collected.reverse();
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTranscriptHtml(channel, ticket, messages) {
  const rows = messages.map((message) => {
    const author = message.author?.tag || 'Unknown';
    const content = message.content ? escapeHtml(message.content) : '<em>(embed or attachment)</em>';
    const time = new Date(message.createdTimestamp).toISOString();
    return `<div class="msg"><div class="meta"><b>${escapeHtml(author)}</b> <span>${time}</span></div><div class="body">${content}</div></div>`;
  }).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Ticket #${ticket.id} transcript</title>
<style>
  body { background:#121216; color:#e5e7eb; font-family: system-ui, sans-serif; margin: 0 auto; max-width: 900px; padding: 24px; }
  .msg { padding: 10px 14px; border-bottom: 1px solid #2a2a33; }
  .meta { color:#9ca3af; font-size: 12px; margin-bottom: 4px; }
  .meta b { color:#e5e7eb; }
  .body { white-space: pre-wrap; }
</style></head>
<body>
<h1>Ticket #${ticket.id} — ${escapeHtml(channel?.name || 'ticket')}</h1>
<p>Opened by user ${ticket.creator_id}, closed at ${new Date().toISOString()}.</p>
${rows || '<p>No messages.</p>'}
</body></html>`;
}
