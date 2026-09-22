// Vouch (+rep) engine: parse "+rep @user description", persist, display.
import { EmbedBuilder } from 'discord.js';
import { database } from '../database/index.js';
import { COLORS, BRAND } from '../config.js';

const MENTION_RE = /<@!?(?<id>\d{17,20})>/;

export function parseVouch(content, authorId) {
  const text = String(content || '').trim();
  if (!text) return { ok: false, error: 'empty' };
  const match = text.match(/^(\+rep|vouch)\s+<@!?(\d{17,20})>\s*([\s\S]*)$/i);
  if (!match) return { ok: false, error: 'format' };
  const targetId = match[2];
  if (targetId === authorId) return { ok: false, error: 'self' };
  const description = match[3].trim().replace(/\s+/g, ' ');
  if (!description) return { ok: false, error: 'description' };
  if (description.length > 500) return { ok: false, error: 'too_long' };
  return { ok: true, targetId, description };
}

export function vouchListEmbed(guild, vouches, { title = 'Vouches', description } = {}) {
  const e = new EmbedBuilder()
    .setColor(COLORS.success)
    .setFooter({ text: BRAND })
    .setTimestamp();
  if (description) e.setDescription(description);
  if (!vouches.length) {
    e.setTitle(title);
    e.setDescription(description || 'No vouches yet. Use `+rep @user reason` to add one.');
    return e;
  }
  e.setTitle(`${title} — ${vouches.length}`);
  e.setDescription(
    vouches.slice(0, 10).map((v, index) =>
      `**#${index + 1}** <@${v.target_id}> vouched by <@${v.author_id}> • <t:${Math.floor(v.created_at / 1000)}:R>\n> ${v.description}`
    ).join('\n\n')
  );
  return e;
}

export async function maybeWarnDuplicateVouch(database, guildId, authorId, targetId) {
  const recent = database.recentVouch(guildId, authorId, targetId, 120);
  return Boolean(recent);
}
