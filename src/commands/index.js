import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder } from 'discord.js';
import { embed, ok, fail } from '../utils/embed.js';
import { database } from '../database/index.js';
import { isValidLtcAddress, isValidUpiId } from '../utils/validate.js';
import { vouchListEmbed } from '../utils/vouch.js';
import { panelSelectRow } from '../utils/tickets.js';
import fs from 'node:fs';
import path from 'node:path';

const admin = PermissionFlagsBits.Administrator;
const mod = PermissionFlagsBits.ModerateMembers;
const manageGuild = PermissionFlagsBits.ManageGuild;
const manageMessages = PermissionFlagsBits.ManageMessages;
const reasonOpt = i => i.options.getString('reason') || 'No reason provided';
const targetOpt = i => i.options.getMember('user');

function guard(i, member) {
  if (!member) return 'Member not found.';
  if (member.id === i.user.id) return 'You cannot target yourself.';
  if (member.id === i.guild.ownerId) return 'The server owner cannot be targeted.';
  if (i.member.id !== i.guild.ownerId && member.roles.highest.position >= i.member.roles.highest.position) return 'Your highest role must be above the target.';
  if (member.roles.highest.position >= i.guild.members.me.roles.highest.position) return 'My highest role must be above the target.';
  return null;
}

function caseLine(c) {
  return `**#${c.id}** \`${c.action}\` by <@${c.moderator_id}> • <t:${Math.floor(c.created_at / 1000)}:R>\n> ${c.reason || 'No reason'}`;
}

// ---------- Moderation ----------
function moderation(name, description, action) {
  return {
    data: new SlashCommandBuilder().setName(name).setDescription(description)
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
      .addStringOption(o => o.setName('evidence').setDescription('Evidence link (screenshot URL)').setRequired(false))
      .setDefaultMemberPermissions(mod)
      .setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i), issue = guard(i, m);
      if (issue) return i.reply({ embeds: [fail(issue)], ephemeral: true });
      const r = reasonOpt(i);
      await action(i, m, r);
      const id = database.caseWithEvidence(i.guildId, m.id, i.user.id, name, r, i.options.getString('evidence'));
      return i.reply({ embeds: [ok(`**${name}** applied to ${m} — case **#${id}**.`)], ephemeral: true });
    }
  };
}

const moderationCommands = [
  moderation('ban', 'Ban a member', async (i, m, r) => { await i.guild.members.ban(m.id, { reason: `${i.user.tag}: ${r}`, deleteMessageSeconds: 0 }); }),
  moderation('kick', 'Kick a member', async (i, m, r) => { await m.kick(`${i.user.tag}: ${r}`); }),
  moderation('softban', 'Ban and immediately unban to purge messages', async (i, m, r) => {
    await i.guild.members.ban(m.id, { reason: `${i.user.tag} (softban): ${r}`, deleteMessageSeconds: 86400 });
    await i.guild.members.unban(m.id, 'Softban auto-unban').catch(() => {});
  }),
  {
    data: new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID')
      .addStringOption(o => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const id = i.options.getString('user_id').trim();
      if (!/^\d{17,20}$/.test(id)) return i.reply({ embeds: [fail('Provide a valid user ID.')], ephemeral: true });
      await i.guild.members.unban(id, `${i.user.tag}: ${reasonOpt(i)}`);
      database.caseWithEvidence(i.guildId, id, i.user.id, 'unban', reasonOpt(i));
      return i.reply({ embeds: [ok(`Unbanned <@${id}>.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('duration').setDescription('Duration in seconds (max 28 days)').setMinValue(60).setMaxValue(2419200).setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i), issue = guard(i, m);
      if (issue) return i.reply({ embeds: [fail(issue)], ephemeral: true });
      await m.timeout(i.options.getInteger('duration') * 1000, `${i.user.tag}: ${reasonOpt(i)}`);
      const id = database.caseWithEvidence(i.guildId, m.id, i.user.id, 'timeout', `${reasonOpt(i)} (${i.options.getInteger('duration')}s)`);
      return i.reply({ embeds: [ok(`Timed out ${m} for **${i.options.getInteger('duration')}s** — case **#${id}**.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('untimeout').setDescription('Remove a member timeout')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i);
      if (!m) return i.reply({ embeds: [fail('Member not found.')], ephemeral: true });
      await m.timeout(null);
      database.caseWithEvidence(i.guildId, m.id, i.user.id, 'untimeout', 'Timeout removed');
      return i.reply({ embeds: [ok(`Timeout removed for ${m}.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i), issue = guard(i, m);
      if (issue) return i.reply({ embeds: [fail(issue)], ephemeral: true });
      const id = database.caseWithEvidence(i.guildId, m.id, i.user.id, 'warn', i.options.getString('reason'));
      try { await m.send({ embeds: [embed(`You were warned in ${i.guild.name}`, `Reason: ${i.options.getString('reason')}`)] }); } catch {}
      return i.reply({ embeds: [ok(`Warned ${m} — case **#${id}**.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('warnings').setDescription('List a member warnings')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const u = i.options.getUser('user');
      const warns = database.casesFor(i.guildId, u.id, 100).filter(c => c.action === 'warn');
      return i.reply({ embeds: [embed(`Warnings — ${u.tag}`, warns.length ? warns.map(caseLine).join('\n') : 'No warnings.')], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('history').setDescription('Full case history for a user')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const u = i.options.getUser('user');
      const cases = database.casesFor(i.guildId, u.id, 25);
      return i.reply({ embeds: [embed(`Moderation history — ${u.tag}`, cases.length ? cases.map(caseLine).join('\n') : 'No cases on record.')], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('case').setDescription('View or edit a moderation case')
      .addSubcommand(s => s.setName('view').setDescription('View a case').addIntegerOption(o => o.setName('id').setDescription('Case ID').setMinValue(1).setRequired(true)))
      .addSubcommand(s => s.setName('reason').setDescription('Edit a case reason').addIntegerOption(o => o.setName('id').setDescription('Case ID').setMinValue(1).setRequired(true)).addStringOption(o => o.setName('new_reason').setDescription('New reason').setRequired(true)))
      .setDefaultMemberPermissions(mod).setDMPermission(false),
    execute: async i => {
      const id = i.options.getInteger('id');
      const row = database.db.prepare('SELECT * FROM moderation_cases WHERE id=? AND guild_id=?').get(id, i.guildId);
      if (!row) return i.reply({ embeds: [fail('Case not found in this server.')], ephemeral: true });
      if (i.options.getSubcommand() === 'reason') {
        database.db.prepare('UPDATE moderation_cases SET reason=? WHERE id=?').run(i.options.getString('new_reason'), id);
        database.audit(i.guildId, i.user.id, 'case_reason_edit', { caseId: id });
        return i.reply({ embeds: [ok(`Case **#${id}** reason updated.`)], ephemeral: true });
      }
      return i.reply({ embeds: [embed(`Case #${row.id}`, `${caseLine(row)}${row.evidence ? `\nEvidence: ${row.evidence}` : ''}`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('clear').setDescription('Delete recent messages')
      .addIntegerOption(o => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))
      .setDefaultMemberPermissions(manageMessages).setDMPermission(false),
    execute: async i => {
      const n = await i.channel.bulkDelete(i.options.getInteger('amount'), true);
      return i.reply({ embeds: [ok(`Deleted **${n.size}** messages.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode')
      .addIntegerOption(o => o.setName('seconds').setDescription('0 to disable, max 21600').setMinValue(0).setMaxValue(21600).setRequired(true))
      .setDefaultMemberPermissions(manageMessages).setDMPermission(false),
    execute: async i => {
      await i.channel.setRateLimitPerUser(i.options.getInteger('seconds'));
      return i.reply({ embeds: [ok(`Slowmode set to **${i.options.getInteger('seconds')}s**.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('lock').setDescription('Lock current channel').setDefaultMemberPermissions(manageMessages).setDMPermission(false),
    execute: async i => {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false }, { reason: `Locked by ${i.user.tag}` });
      return i.reply({ embeds: [ok('Channel locked.')], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('unlock').setDescription('Unlock current channel').setDefaultMemberPermissions(manageMessages).setDMPermission(false),
    execute: async i => {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null }, { reason: `Unlocked by ${i.user.tag}` });
      return i.reply({ embeds: [ok('Channel unlocked.')], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('nick').setDescription('Change a member nickname')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addStringOption(o => o.setName('nickname').setDescription('Leave empty to reset').setMaxLength(32))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames).setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i), nick = i.options.getString('nickname');
      if (!m) return i.reply({ embeds: [fail('Member not found.')], ephemeral: true });
      if (!m.manageable) return i.reply({ embeds: [fail('I cannot manage that member nickname.')], ephemeral: true });
      await m.setNickname(nick, `${i.user.tag}: /nick`);
      database.caseWithEvidence(i.guildId, m.id, i.user.id, 'nick', nick ? `Nickname set to "${nick}"` : 'Nickname reset');
      return i.reply({ embeds: [ok(nick ? `Nickname set to **${nick}**.` : 'Nickname reset.')], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('role').setDescription('Add a role to a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
      .setDefaultMemberPermissions(manageGuild).setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i), role = i.options.getRole('role');
      if (!m) return i.reply({ embeds: [fail('Member not found.')], ephemeral: true });
      await m.roles.add(role, `${i.user.tag}: /role`);
      database.caseWithEvidence(i.guildId, m.id, i.user.id, 'role_add', `Role <@&${role.id}> added`);
      return i.reply({ embeds: [ok(`Added ${role} to ${m}.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('removerole').setDescription('Remove a role from a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
      .setDefaultMemberPermissions(manageGuild).setDMPermission(false),
    execute: async i => {
      const m = targetOpt(i), role = i.options.getRole('role');
      if (!m) return i.reply({ embeds: [fail('Member not found.')], ephemeral: true });
      await m.roles.remove(role, `${i.user.tag}: /removerole`);
      database.caseWithEvidence(i.guildId, m.id, i.user.id, 'role_remove', `Role <@&${role.id}> removed`);
      return i.reply({ embeds: [ok(`Removed ${role} from ${m}.`)], ephemeral: true });
    }
  }
];

// ---------- Vouches ----------
const vouchCommands = [
  {
    data: new SlashCommandBuilder().setName('vouch').setDescription('Vouch system — sellers get +rep from buyers')
      .addSubcommand(s => s.setName('view').setDescription('View vouches for a user').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
      .addSubcommand(s => s.setName('me').setDescription('View your vouches'))
      .addSubcommand(s => s.setName('top').setDescription('Most vouched members in this server'))
      .addSubcommand(s => s.setName('latest').setDescription('Latest vouches in this server'))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a vouch (author, target, or mods)').addIntegerOption(o => o.setName('id').setDescription('Vouch ID from /vouch view').setMinValue(1).setRequired(true)))
      .setDMPermission(false),
    execute: async i => {
      const sub = i.options.getSubcommand();
      if (sub === 'me') {
        const rows = database.vouchesFor(i.guildId, i.user.id, 10);
        const counter = database.vouchCounter(i.user.id);
        return i.reply({ embeds: [vouchListEmbed(i.guild, rows, { title: `Your vouches`, description: `⭐ **${counter?.total ?? 0}** total vouches • **${counter?.month_key === currentMonthKey() ? counter.month : 0}** this month` })] });
      }
      if (sub === 'view') {
        const u = i.options.getUser('user');
        const rows = database.vouchesFor(i.guildId, u.id, 10);
        const counter = database.vouchCounter(u.id);
        return i.reply({ embeds: [vouchListEmbed(i.guild, rows, { title: `Vouches — ${u.tag}`, description: `⭐ **${counter?.total ?? 0}** total vouches` })] });
      }
      if (sub === 'top') {
        const rows = database.topVouched(i.guildId, 10);
        return i.reply({ embeds: [embed('🏆 Most vouched', rows.length ? rows.map((r, idx) => `**${idx + 1}.** <@${r.target_id}> — ⭐ **${r.c}**`).join('\n') : 'No vouches yet. Use `+rep @user reason`.')] });
      }
      if (sub === 'latest') {
        const rows = database.latestVouches(i.guildId, 10);
        return i.reply({ embeds: [vouchListEmbed(i.guild, rows, { title: 'Latest vouches' })] });
      }
      if (sub === 'remove') {
        const v = database.vouchById(i.options.getInteger('id'));
        if (!v || v.guild_id !== i.guildId) return i.reply({ embeds: [fail('Vouch not found.')], ephemeral: true });
        const allowed = v.author_id === i.user.id || v.target_id === i.user.id || i.memberPermissions.has(PermissionFlagsBits.ModerateMembers);
        if (!allowed) return i.reply({ embeds: [fail('Only the vouch author, the target, or moderators can remove it.')], ephemeral: true });
        database.removeVouch(v.id);
        database.db.prepare('UPDATE vouch_counters SET total=MAX(total-1,0) WHERE user_id=?').run(v.target_id);
        database.audit(i.guildId, i.user.id, 'vouch_remove', { vouchId: v.id });
        return i.reply({ embeds: [ok(`Vouch **#${v.id}** removed.`)], ephemeral: true });
      }
    }
  }
];

function currentMonthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }

// ---------- Payouts ----------
const payoutCommands = [
  {
    data: new SlashCommandBuilder().setName('payout').setDescription('Save your payment addresses (private, only you see them)')
      .addSubcommand(s => s.setName('save').setDescription('Save a payout method')
        .addStringOption(o => o.setName('type').setDescription('Method type').addChoices({ name: 'Litecoin (LTC)', value: 'ltc' }, { name: 'UPI', value: 'upi' }, { name: 'Bank / other (manual)', value: 'bank' }).setRequired(true))
        .addStringOption(o => o.setName('address').setDescription('LTC address, UPI ID, or bank details').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Label e.g. "Main LTC wallet"').setMaxLength(50)))
      .addSubcommand(s => s.setName('list').setDescription('List your saved payout methods'))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a saved payout method').addIntegerOption(o => o.setName('id').setDescription('Method ID from /payout list').setMinValue(1).setRequired(true)))
      .addSubcommand(s => s.setName('default').setDescription('Set your default payout method').addIntegerOption(o => o.setName('id').setDescription('Method ID from /payout list').setMinValue(1).setRequired(true)))
      .addSubcommand(s => s.setName('confirm').setDescription('Confirm a saved method (2-step anti-theft check)')
        .addIntegerOption(o => o.setName('id').setDescription('Method ID from /payout list').setMinValue(1).setRequired(true))
        .addStringOption(o => o.setName('token').setDescription('Token from the first confirm call')))
      .setDMPermission(false),
    execute: async i => {
      const sub = i.options.getSubcommand();
      if (sub === 'save') {
        const type = i.options.getString('type');
        const address = i.options.getString('address').trim();
        if (type === 'ltc' && !isValidLtcAddress(address)) return i.reply({ embeds: [fail('That is not a valid Litecoin address. Expected `ltc1…` (bech32) or `L…`/`M…` legacy with valid checksum.')], ephemeral: true });
        if (type === 'upi' && !isValidUpiId(address)) return i.reply({ embeds: [fail('That is not a valid UPI ID. Format: `name@bank` e.g. `yourname@okhdfcbank`.')], ephemeral: true });
        if (type === 'bank' && address.length < 6) return i.reply({ embeds: [fail('Bank details too short.')], ephemeral: true });
        if (/^(5H|5J|5K|Kx|L1|L2|L3|L4|L5)[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(address)) return i.reply({ embeds: [fail('That looks like a private key. NEVER share private keys — I only accept public addresses.')], ephemeral: true });
        const id = database.addPayout(i.user.id, type, type === 'upi' ? address.toLowerCase() : address, i.options.getString('label'));
        database.audit(i.guildId ?? 'dm', i.user.id, 'payout_save', { id, type });
        return i.reply({ embeds: [ok(`Saved payout method **#${id}** (${type}). Use \`/payout list\` to see it. Run \`/payout confirm id:${id}\` to verify it.`)], ephemeral: true });
      }
      if (sub === 'list') {
        const rows = database.payoutsFor(i.user.id);
        if (!rows.length) return i.reply({ embeds: [embed('Your payout methods', 'Nothing saved yet. Use `/payout save`.')], ephemeral: true });
        return i.reply({ embeds: [embed('Your payout methods', rows.map(r => `**#${r.id}** ${r.type.toUpperCase()} — \`${r.address}\`${r.label ? ` (${r.label})` : ''}${r.is_default ? ' ⭐ default' : ''}${r.confirmed ? ' ✅' : ' ⚠️ unconfirmed'}`).join('\n'))], ephemeral: true });
      }
      if (sub === 'remove') {
        const n = database.removePayout(i.user.id, i.options.getInteger('id'));
        return i.reply({ embeds: [n ? ok('Payout method removed.') : fail('That method ID is not yours or does not exist.')], ephemeral: true });
      }
      if (sub === 'default') {
        const id = i.options.getInteger('id');
        const owns = database.db.prepare('SELECT id FROM payouts WHERE id=? AND user_id=?').get(id, i.user.id);
        if (!owns) return i.reply({ embeds: [fail('That method ID is not yours or does not exist.')], ephemeral: true });
        database.setDefaultPayout(i.user.id, id);
        return i.reply({ embeds: [ok(`Default payout method set to **#${id}**.`)], ephemeral: true });
      }
      if (sub === 'confirm') {
        const id = i.options.getInteger('id');
        const row = database.db.prepare('SELECT * FROM payouts WHERE id=? AND user_id=?').get(id, i.user.id);
        if (!row) return i.reply({ embeds: [fail('That method ID is not yours or does not exist.')], ephemeral: true });
        const token = i.options.getString('token');
        if (!token) {
          const generated = Math.random().toString(36).slice(2, 8).toUpperCase();
          database.db.prepare('UPDATE payouts SET confirm_token=?, confirm_expires_at=? WHERE id=?').run(generated, Date.now() + 10 * 60 * 1000, id);
          return i.reply({ embeds: [embed('Confirm payout method', `Run \`/payout confirm id:${id} token:${generated}\` within **10 minutes** to verify this method.\nThis protects you if someone else gets access to your account.`)], ephemeral: true });
        }
        if (!row.confirm_token || row.confirm_token !== token.trim().toUpperCase()) return i.reply({ embeds: [fail('Wrong token.')], ephemeral: true });
        if (!row.confirm_expires_at || row.confirm_expires_at < Date.now()) return i.reply({ embeds: [fail('Token expired. Run confirm again.')], ephemeral: true });
        database.markPayoutConfirmed(i.user.id, id);
        return i.reply({ embeds: [ok(`Payout method **#${id}** confirmed ✅`)], ephemeral: true });
      }
    }
  }
];

// ---------- Tickets ----------
const ticketCommands = [
  {
    data: new SlashCommandBuilder().setName('ticketpanel').setDescription('Ticket panels')
      .addSubcommand(s => s.setName('create').setDescription('Post a ticket panel here').addStringOption(o => o.setName('title').setDescription('Panel title').setMaxLength(100).setRequired(true)).addStringOption(o => o.setName('description').setDescription('Panel description').setMaxLength(1000)))
      .addSubcommand(s => s.setName('refresh').setDescription('Rebuild a panel select menu after category changes').addStringOption(o => o.setName('message_id').setDescription('Panel message ID').setRequired(true)))
      .setDefaultMemberPermissions(admin).setDMPermission(false),
    execute: async i => {
      if (i.options.getSubcommand() === 'refresh') {
        const panel = database.panelByMessageId(i.options.getString('message_id'));
        if (!panel || panel.guild_id !== i.guildId) return i.reply({ embeds: [fail('Panel not found.')], ephemeral: true });
        await refreshPanel(i.client, panel.id);
        return i.reply({ embeds: [ok('Panel refreshed.')], ephemeral: true });
      }
      const title = i.options.getString('title');
      const description = i.options.getString('description') || 'Select a category below to open a private ticket with our team.';
      const msg = await i.channel.send({
        embeds: [embed(title, description)],
        components: [panelSelectRow(null, [])]
      });
      const panelId = database.addPanel(i.guildId, i.channelId, msg.id, title, description);
      await msg.edit({ components: [panelSelectRow(panelId, [])] });
      return i.reply({ embeds: [ok(`Ticket panel posted (panel **#${panelId}**). Now add categories with \`/ticketcategory add\`.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('ticketcategory').setDescription('Add a category to the latest ticket panel')
      .addStringOption(o => o.setName('key').setDescription('Short unique key e.g. billing').setMaxLength(20).setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Display name e.g. "Billing"').setMaxLength(80).setRequired(true))
      .addRoleOption(o => o.setName('staff_role_1').setDescription('Staff role that sees these tickets').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Shown in the select menu').setMaxLength(100))
      .addRoleOption(o => o.setName('staff_role_2').setDescription('Second staff role'))
      .addRoleOption(o => o.setName('staff_role_3').setDescription('Third staff role'))
      .addChannelOption(o => o.setName('destination').setDescription('Channel category to create tickets under').addChannelTypes(ChannelType.GuildCategory))
      .addStringOption(o => o.setName('name_format').setDescription('Ticket channel name, default ticket-{username}'))
      .addIntegerOption(o => o.setName('open_limit').setDescription('Max open tickets per user (default 1)').setMinValue(1).setMaxValue(5))
      .setDefaultMemberPermissions(admin).setDMPermission(false),
    execute: async i => {
      const panel = database.db.prepare('SELECT * FROM ticket_panels WHERE guild_id=? ORDER BY id DESC LIMIT 1').get(i.guildId);
      if (!panel) return i.reply({ embeds: [fail('Create a panel first with `/ticketpanel create`.')], ephemeral: true });
      const key = i.options.getString('key').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (database.categoryByKeyAndPanel(key, panel.id)) return i.reply({ embeds: [fail(`Key \`${key}\` already exists on this panel.`)], ephemeral: true });
      const roles = [i.options.getRole('staff_role_1'), i.options.getRole('staff_role_2'), i.options.getRole('staff_role_3')].filter(Boolean).map(r => r.id);
      const id = database.addCategory(panel.id, key, i.options.getString('label'), i.options.getString('description'), roles, i.options.getString('name_format'), i.options.getChannel('destination')?.id, i.options.getInteger('open_limit'));
      await refreshPanel(i.client, panel.id);
      return i.reply({ embeds: [ok(`Category **${i.options.getString('label')}** added (id ${id}). Add form fields with \`/ticketfield add\`.`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('ticketfield').setDescription('Add a form field to a ticket category (modal question)')
      .addStringOption(o => o.setName('category_key').setDescription('Category key from /ticketcategory').setMaxLength(20).setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Question label (max 45 chars)').setMaxLength(45).setRequired(true))
      .addStringOption(o => o.setName('style').setDescription('Input style').addChoices({ name: 'Short text', value: 'short' }, { name: 'Paragraph', value: 'paragraph' }).setRequired(true))
      .addBooleanOption(o => o.setName('required').setDescription('Is answering required?'))
      .addStringOption(o => o.setName('placeholder').setDescription('Placeholder text').setMaxLength(100))
      .addStringOption(o => o.setName('choices').setDescription('Comma-separated allowed values (exact match validation)'))
      .addBooleanOption(o => o.setName('replace_existing').setDescription('Clear existing fields for this category first'))
      .setDefaultMemberPermissions(admin).setDMPermission(false),
    execute: async i => {
      const panel = database.db.prepare('SELECT id FROM ticket_panels WHERE guild_id=? ORDER BY id DESC LIMIT 1').get(i.guildId);
      if (!panel) return i.reply({ embeds: [fail('Create a panel first.')], ephemeral: true });
      const category = database.categoryByKeyAndPanel(i.options.getString('category_key').toLowerCase(), panel.id);
      if (!category) return i.reply({ embeds: [fail('Category not found on the latest panel.')], ephemeral: true });
      if (i.options.getBoolean('replace_existing')) database.clearFields(category.id);
      const existing = database.db.prepare('SELECT COUNT(*) c FROM ticket_form_fields WHERE category_id=?').get(category.id).c;
      if (existing >= 5) return i.reply({ embeds: [fail('A category supports max 5 fields (Discord modal limit).')], ephemeral: true });
      const choices = i.options.getString('choices');
      const choiceList = choices ? choices.split(',').map(c => c.trim()).filter(Boolean) : null;
      database.addField(category.id, i.options.getString('label'), i.options.getString('style'), i.options.getBoolean('required') ?? true, i.options.getString('placeholder'), choiceList, null, null, existing);
      const total = database.db.prepare('SELECT COUNT(*) c FROM ticket_form_fields WHERE category_id=?').get(category.id).c;
      return i.reply({ embeds: [ok(`Field added to **${category.label}** (${total}/5).`)], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('ticket').setDescription('Ticket controls')
      .addSubcommand(s => s.setName('close').setDescription('Close this ticket').addStringOption(o => o.setName('reason').setDescription('Close reason').setMaxLength(500)))
      .addSubcommand(s => s.setName('reopen').setDescription('Reopen this closed ticket'))
      .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket'))
      .addSubcommand(s => s.setName('unclaim').setDescription('Release your claim'))
      .addSubcommand(s => s.setName('priority').setDescription('Set priority').addStringOption(o => o.setName('level').setDescription('Priority level').addChoices({ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }, { name: 'Critical', value: 'critical' }).setRequired(true)))
      .addSubcommand(s => s.setName('add').setDescription('Add a user to this ticket').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove a user from this ticket').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
      .addSubcommand(s => s.setName('transcript').setDescription('Generate and post the HTML transcript'))
      .addSubcommand(s => s.setName('delete').setDescription('Delete this ticket channel (must be closed)'))
      .addSubcommand(s => s.setName('blacklist').setDescription('Block a user from opening tickets').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
      .addSubcommand(s => s.setName('unblacklist').setDescription('Allow a user to open tickets again').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels).setDMPermission(false),
    execute: async i => {
      const sub = i.options.getSubcommand();
      if (sub === 'blacklist' || sub === 'unblacklist') {
        const u = i.options.getUser('user');
        const s = database.getSettings(i.guildId);
        const list = new Set(s.ticketBlacklist || []);
        if (sub === 'blacklist') { list.add(u.id); database.audit(i.guildId, i.user.id, 'ticket_blacklist', { user: u.id }); }
        else list.delete(u.id);
        s.ticketBlacklist = [...list];
        database.saveSettings(i.guildId, s);
        return i.reply({ embeds: [ok(sub === 'blacklist' ? `${u} can no longer open tickets.` : `${u} can open tickets again.`)], ephemeral: true });
      }
      const ticket = database.ticketByChannel(i.channelId);
      if (!ticket) return i.reply({ embeds: [fail('Run this inside a ticket channel.')], ephemeral: true });
      const { closeTicket, reopenTicket } = await import('../utils/tickets.js');
      const { isStaffForTicket } = await import('../utils/tickets.js');
      if (sub === 'close') {
        if (!isStaffForTicket(i.member, ticket) && ticket.creator_id !== i.user.id) return i.reply({ embeds: [fail('Only staff or the ticket owner can close.')], ephemeral: true });
        await i.deferReply();
        await closeTicket(i.client, i.channel, ticket, i.options.getString('reason') || 'No reason provided', i.user.id);
        return i.followUp({ embeds: [ok('Ticket closed. Transcript generated and DM\u2019d to the owner if possible.')] });
      }
      if (sub === 'reopen') {
        await reopenTicket(i.channel, ticket);
        return i.reply({ embeds: [ok('Ticket reopened.')], ephemeral: true });
      }
      if (sub === 'claim') {
        if (!isStaffForTicket(i.member, ticket)) return i.reply({ embeds: [fail('Staff only.')], ephemeral: true });
        database.updateTicket(i.channelId, { claimed_by: i.user.id, status: 'claimed', claimed_at: Date.now() });
        return i.reply({ embeds: [ok(`${i.user} claimed this ticket.`)] });
      }
      if (sub === 'unclaim') {
        database.updateTicket(i.channelId, { claimed_by: null, status: 'open', claimed_at: null });
        return i.reply({ embeds: [ok('Ticket unclaimed.')], ephemeral: true });
      }
      if (sub === 'priority') {
        if (!isStaffForTicket(i.member, ticket)) return i.reply({ embeds: [fail('Staff only.')], ephemeral: true });
        database.updateTicket(i.channelId, { priority: i.options.getString('level') });
        return i.reply({ embeds: [ok(`Priority set to **${i.options.getString('level')}**.`)], ephemeral: true });
      }
      if (sub === 'add' || sub === 'remove') {
        const u = i.options.getUser('user');
        await i.channel.permissionOverwrites.edit(u.id, sub === 'add'
          ? { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }
          : { ViewChannel: false, SendMessages: false, ReadMessageHistory: false });
        return i.reply({ embeds: [ok(`${u} ${sub === 'add' ? 'added to' : 'removed from'} the ticket.`)], ephemeral: true });
      }
      if (sub === 'transcript') {
        const { saveTranscript } = await import('../utils/tickets.js');
        await i.deferReply();
        const file = await saveTranscript(i.channel, ticket);
        const attachment = new AttachmentBuilder(fs.readFileSync(file), { name: path.basename(file) });
        return i.followUp({ embeds: [ok('Transcript generated.')], files: [attachment] });
      }
      if (sub === 'delete') {
        if (ticket.status !== 'closed') return i.reply({ embeds: [fail('Close the ticket first.')], ephemeral: true });
        await i.reply({ embeds: [ok('Deleting channel…')], ephemeral: true });
        await i.channel.delete('Ticket deleted by staff');
      }
    }
  }
];

// ---------- Config ----------
const configCommand = {
  data: new SlashCommandBuilder().setName('config').setDescription('Configure server').setDefaultMemberPermissions(admin)
    .addSubcommand(s => s.setName('view').setDescription('View settings'))
    .addSubcommand(s => s.setName('welcome').setDescription('Set welcome channel').addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('goodbye').setDescription('Set goodbye channel').addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('logs').setDescription('Set logs channel').addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('vouchchannel').setDescription('Channel where +rep confirmations are mirrored').addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName('moderation').setDescription('Enable or disable moderation cases').addBooleanOption(o => o.setName('enabled').setDescription('Enabled').setRequired(true)))
    .addSubcommand(s => s.setName('automod').setDescription('Enable or disable automod').addBooleanOption(o => o.setName('enabled').setDescription('Enabled').setRequired(true)))
    .addSubcommand(s => s.setName('tickets').setDescription('Global ticket staff role (fallback)').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('autoclose').setDescription('Auto-close idle tickets').addIntegerOption(o => o.setName('warn_hours').setDescription('Hours before warning (default 24)').setMinValue(1)).addIntegerOption(o => o.setName('close_hours').setDescription('Hours before auto-close (default 48)').setMinValue(2)))
    .addSubcommand(s => s.setName('verification').setDescription('Set verification roles').addRoleOption(o => o.setName('verified_role').setDescription('Verified role').setRequired(true)).addRoleOption(o => o.setName('unverified_role').setDescription('Optional unverified role')))
    .addSubcommand(s => s.setName('autorole').setDescription('Set autorole').addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .setDMPermission(false),
  execute: async i => {
    const s = database.getSettings(i.guildId), sub = i.options.getSubcommand();
    if (sub === 'view') {
      const { panelSelectRow } = await import('../utils/tickets.js');
      const panels = database.db.prepare('SELECT * FROM ticket_panels WHERE guild_id=?').all(i.guildId);
      const lines = [];
      for (const p of panels) {
        const cats = database.categoriesForPanel(p.id);
        lines.push(`Panel **#${p.id}** (<#${p.channel_id}>, msg \`${p.message_id}\`): ${cats.length ? cats.map(c => `\`${c.key}\``).join(', ') : 'no categories'}`);
      }
      return i.reply({ embeds: [embed('Server configuration', '```json\n' + JSON.stringify(s, null, 2).slice(0, 900) + '\n```\n**Ticket panels:**\n' + (lines.join('\n') || 'None'))], ephemeral: true });
    }
    const map = { welcome: 'channel', goodbye: 'channel', logs: 'channel', vouchchannel: 'channel', moderation: 'enabled', automod: 'enabled', tickets: 'role', autorole: 'role' };
    if (sub === 'verification') {
      s.verification = { verifiedRole: i.options.getRole('verified_role').id, unverifiedRole: i.options.getRole('unverified_role')?.id || null };
    } else if (sub === 'autoclose') {
      const warn = i.options.getInteger('warn_hours'), close = i.options.getInteger('close_hours');
      if (warn) s.autoCloseWarnHours = warn;
      if (close) s.autoCloseHours = close;
    } else {
      s[sub === 'moderation' ? 'moderationEnabled' : sub] = map[sub] === 'channel' ? i.options.getChannel('channel').id : map[sub] === 'role' ? i.options.getRole('role').id : i.options.getBoolean('enabled');
    }
    database.saveSettings(i.guildId, s);
    return i.reply({ embeds: [ok(`Configuration **${sub}** saved.`)], ephemeral: true });
  }
};

// ---------- Core / legacy ----------
const coreCommands = [
  { data: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency').setDMPermission(false), execute: i => i.reply({ embeds: [embed('Pong', `API latency: **${i.client.ws.ping}ms**`)], ephemeral: true }) },
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Show commands').setDMPermission(false),
    execute: i => i.reply({ embeds: [embed('NIGHTMARE V2.44 — Commands',
      '**Vouches** — `+rep @user reason` in chat • `/vouch view|me|top|latest|remove`\n' +
      '**Tickets** — `/ticketpanel create` • `/ticketcategory add` • `/ticketfield add` • `/ticket close|claim|priority|add|remove|transcript|reopen|delete|blacklist`\n' +
      '**Payouts** — `/payout save|list|remove|default|confirm` (LTC / UPI / bank, private to you)\n' +
      '**Moderation** — `/ban /softban /unban /kick /timeout /untimeout /warn /warnings /history /case /clear /slowmode /lock /unlock /nick /role /removerole`\n' +
      '**Config** — `/config view|welcome|goodbye|logs|vouchchannel|moderation|automod|tickets|autoclose|verification|autorole`\n' +
      '**Other** — `/ping /serverinfo /userinfo /giveaway /verification /owner`')] })
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show server information').setDMPermission(false),
    execute: i => i.reply({ embeds: [embed(i.guild.name, `Members: **${i.guild.memberCount}**\nOwner: <@${i.guild.ownerId}>\nCreated: <t:${Math.floor(i.guild.createdTimestamp / 1000)}:R>`)] })
  },
  {
    data: new SlashCommandBuilder().setName('userinfo').setDescription('Show user information').addUserOption(o => o.setName('user').setDescription('User')).setDMPermission(false),
    execute: i => {
      const u = i.options.getUser('user') || i.user;
      const vouches = database.vouchCounter(u.id);
      return i.reply({ embeds: [embed(u.tag, `ID: \`${u.id}\`\nVouches: ⭐ **${vouches?.total ?? 0}**`)] });
    }
  }
];

const commands = [
  ...coreCommands,
  ...moderationCommands,
  ...vouchCommands,
  ...payoutCommands,
  ...ticketCommands,
  configCommand,
  // Legacy commands preserved from the previous release:
  // giveaway, verification setup, owner tools (loaded below)
  ...await loadLegacyCommands()
];

async function loadLegacyCommands() {
  const mod = await import('./legacy.js');
  return mod.legacyCommands;
}

export async function loadCommands(client) { for (const c of commands) client.commands.set(c.data.name, c); }
export { commands };

// Imported late to avoid circular import; defined here because ticket panel refresh needs client.
async function refreshPanel(client, panelId) {
  const { panelSelectRow } = await import('../utils/tickets.js');
  const panel = database.panelById(panelId);
  if (!panel) return;
  const categories = database.categoriesForPanel(panelId);
  const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
  if (!channel) return;
  const message = await channel.messages.fetch(panel.message_id).catch(() => null);
  if (!message) return;
  await message.edit({ components: [panelSelectRow(panel.id, categories)] });
}
