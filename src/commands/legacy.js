// Legacy commands carried over from the previous release: giveaways, verification panel, owner tools.
import { SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { embed, ok, fail } from '../utils/embed.js';
import { database } from '../database/index.js';

export const legacyCommands = [
  {
    data: new SlashCommandBuilder().setName('giveaway').setDescription('Manage giveaways').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setDMPermission(false)
      .addSubcommand(s => s.setName('start').setDescription('Start giveaway').addIntegerOption(o => o.setName('duration').setDescription('Seconds').setMinValue(10).setRequired(true)).addIntegerOption(o => o.setName('winners').setDescription('Winner count').setMinValue(1).setMaxValue(20).setRequired(true)).addStringOption(o => o.setName('prize').setDescription('Prize').setMaxLength(200).setRequired(true)))
      .addSubcommand(s => s.setName('end').setDescription('End giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
      .addSubcommand(s => s.setName('reroll').setDescription('Reroll giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('List giveaways')),
    execute: async i => {
      const sub = i.options.getSubcommand();
      if (sub === 'list') {
        const rows = database.db.prepare('SELECT message_id,prize,ends_at,ended FROM giveaways WHERE guild_id=? ORDER BY ends_at DESC LIMIT 20').all(i.guildId);
        return i.reply({ embeds: [embed('Giveaways', rows.length ? rows.map(x => `\`${x.message_id}\` — ${x.prize} — ${x.ended ? 'ended' : `ends <t:${Math.floor(x.ends_at / 1000)}:R>`}`).join('\n') : 'No giveaways.')], ephemeral: true });
      }
      const { finishGiveaway } = await import('../database/index.js');
      if (sub === 'start') {
        const end = Date.now() + i.options.getInteger('duration') * 1000;
        const msg = await i.channel.send({ embeds: [embed('🎉 Giveaway', `Prize: **${i.options.getString('prize')}**\nEnds: <t:${Math.floor(end / 1000)}:R>\nClick Enter to participate.`)], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway:enter').setLabel('Enter').setStyle(ButtonStyle.Success))] });
        database.db.prepare('INSERT INTO giveaways(message_id,guild_id,channel_id,prize,ends_at,winners) VALUES(?,?,?,?,?,?)').run(msg.id, i.guildId, i.channelId, i.options.getString('prize'), end, i.options.getInteger('winners'));
        return i.reply({ embeds: [ok(`Giveaway started: ${msg.url}`)], ephemeral: true });
      }
      const row = database.giveaway(i.options.getString('message_id'));
      if (!row || row.guild_id !== i.guildId) return i.reply({ embeds: [fail('Giveaway not found.')], ephemeral: true });
      if (sub === 'reroll' && !row.ended) return i.reply({ embeds: [fail('End the giveaway before rerolling.')], ephemeral: true });
      await finishGiveaway(i.client, row, sub === 'reroll');
      return i.reply({ embeds: [ok(sub === 'end' ? 'Giveaway ended.' : 'Winner rerolled.')], ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('verification').setDescription('Post verification panel').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false)
      .addSubcommand(s => s.setName('setup').setDescription('Post Verify button')),
    execute: async i => {
      const s = database.getSettings(i.guildId);
      if (!s.verification?.verifiedRole) return i.reply({ embeds: [fail('Configure the verified role first with `/config verification`.')], ephemeral: true });
      return i.reply({ embeds: [embed('Verification', 'Click Verify to receive the configured role.')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verification:verify').setLabel('Verify').setStyle(ButtonStyle.Success))] });
    }
  },
  {
    data: new SlashCommandBuilder().setName('owner').setDescription('Owner tools').addStringOption(o => o.setName('action').setDescription('reload/status/servers').setRequired(true)).addStringOption(o => o.setName('message').setDescription('Broadcast text')).setDMPermission(false),
    execute: async i => {
      if (i.user.id !== process.env.OWNER_ID) return i.reply({ embeds: [fail('Owner only.')], ephemeral: true });
      const a = i.options.getString('action');
      if (a === 'status') return i.reply({ embeds: [ok(`Ready: **${i.client.ws.status}**, servers: **${i.client.guilds.cache.size}**, ping: **${i.client.ws.ping}ms**`)], ephemeral: true });
      if (a === 'servers') return i.reply({ embeds: [ok(i.client.guilds.cache.map(g => `${g.name} (${g.id})`).join('\n') || 'No servers.')], ephemeral: true });
      if (a === 'reload') return i.reply({ embeds: [ok('Reload acknowledged; restart the process to apply code changes.')], ephemeral: true });
      return i.reply({ embeds: [fail('Unknown owner action. Use status/servers/reload.')], ephemeral: true });
    }
  }
];
