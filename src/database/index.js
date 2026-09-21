import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const file = process.env.DATABASE_PATH || './data/nightmare.sqlite';
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
const db = new Database(file);
const json = value => JSON.stringify(value ?? {});

export const database = {
  db,
  init() {
    db.exec(`CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS moderation_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT UNIQUE NOT NULL, creator_id TEXT NOT NULL, claimed_by TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, closed_at INTEGER);
      CREATE TABLE IF NOT EXISTS giveaways (message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, prize TEXT NOT NULL, ends_at INTEGER NOT NULL, winners INTEGER NOT NULL, ended INTEGER NOT NULL DEFAULT 0, entries TEXT NOT NULL DEFAULT '[]');`);
  },
  getSettings(guildId) { const row = db.prepare('SELECT data FROM guild_settings WHERE guild_id=?').get(guildId); return row ? JSON.parse(row.data) : {}; },
  saveSettings(guildId, data) { db.prepare('INSERT INTO guild_settings(guild_id,data) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data').run(guildId, json(data)); },
  case(guildId, userId, moderatorId, action, reason) { return db.prepare('INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES(?,?,?,?,?,?)').run(guildId,userId,moderatorId,action,reason,Date.now()).lastInsertRowid; },
  giveaway(messageId) { const row = db.prepare('SELECT * FROM giveaways WHERE message_id=?').get(messageId); return row && { ...row, entries: JSON.parse(row.entries) }; },
  activeGiveaways() { return db.prepare('SELECT * FROM giveaways WHERE ended=0 AND ends_at<=?').all(Date.now()); },
  addGiveawayEntry(messageId, userId) { const row = this.giveaway(messageId); if (!row || row.ended || row.entries.includes(userId)) return false; row.entries.push(userId); db.prepare('UPDATE giveaways SET entries=? WHERE message_id=?').run(JSON.stringify(row.entries), messageId); return true; },
  endGiveaway(messageId, winners) { db.prepare('UPDATE giveaways SET ended=1, entries=? WHERE message_id=?').run(JSON.stringify(winners), messageId); }
};

export { db };
// Initialize on import so command modules are safe in tests and registrations.
database.init();
export function pickWinners(entries, count) { return [...entries].sort(() => Math.random() - 0.5).slice(0, Math.max(1, count)); }
export async function finishGiveaway(client, row, reroll = false) {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null);
  const message = channel ? await channel.messages.fetch(row.message_id).catch(() => null) : null;
  if (!message) { database.endGiveaway(row.message_id, []); return []; }
  const winners = pickWinners(row.entries, row.winners);
  database.endGiveaway(row.message_id, winners);
  await message.edit({ content: `🎉 Giveaway **${row.prize}** has ended!`, components: [], embeds: [] }).catch(() => {});
  if (winners.length) await channel.send(`${reroll ? '🔁 Reroll' : '🎉'} winner${winners.length > 1 ? 's' : ''}: ${winners.map(id => `<@${id}>`).join(', ')} — **${row.prize}**`).catch(() => {});
  else await channel.send(`Giveaway **${row.prize}** ended with no entries.`).catch(() => {});
  return winners;
}
