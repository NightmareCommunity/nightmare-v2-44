import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../utils/logger.js';

const file = process.env.DATABASE_PATH || './data/nightmare.sqlite';
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL;');
const json = value => JSON.stringify(value ?? {});

// node:sqlite has no db.transaction(fn) wrapper (better-sqlite3 API) — emulate it.
function withTransaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export const database = {
  db,
  init() {
    try {
    db.exec(`CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS moderation_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT, evidence TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, panel_id INTEGER, category_id TEXT, channel_id TEXT UNIQUE NOT NULL, creator_id TEXT NOT NULL, claimed_by TEXT, priority TEXT NOT NULL DEFAULT 'low', status TEXT NOT NULL DEFAULT 'open', close_reason TEXT, transcript TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER, closed_at INTEGER, last_activity_at INTEGER, last_warned_at INTEGER);
      CREATE TABLE IF NOT EXISTS ticket_panels (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ticket_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, panel_id INTEGER NOT NULL REFERENCES ticket_panels(id) ON DELETE CASCADE, key TEXT NOT NULL, label TEXT NOT NULL, description TEXT, staff_roles TEXT NOT NULL DEFAULT '[]', ticket_name_format TEXT NOT NULL DEFAULT 'ticket-{username}', parent_category_id TEXT, open_limit_per_user INTEGER NOT NULL DEFAULT 1, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, required_role_id TEXT, min_account_age_days INTEGER NOT NULL DEFAULT 0, max_ticket_age_days INTEGER NOT NULL DEFAULT 30, disabled INTEGER NOT NULL DEFAULT 0, UNIQUE(panel_id, key));
      CREATE TABLE IF NOT EXISTS ticket_form_fields (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE, label TEXT NOT NULL, style TEXT NOT NULL DEFAULT 'short', required INTEGER NOT NULL DEFAULT 1, placeholder TEXT, min_length INTEGER, max_length INTEGER, validation TEXT, choices TEXT, position INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('ltc','upi','bank')), address TEXT NOT NULL, label TEXT, is_default INTEGER NOT NULL DEFAULT 0, confirmed INTEGER NOT NULL DEFAULT 0, confirm_token TEXT, confirm_expires_at INTEGER, created_at INTEGER NOT NULL, last_used_at INTEGER, UNIQUE(user_id, type, address));
      CREATE TABLE IF NOT EXISTS vouches (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, target_id TEXT NOT NULL, author_id TEXT NOT NULL, description TEXT, deal_value TEXT, proof_url TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, edited_at INTEGER);
      CREATE TABLE IF NOT EXISTS vouch_counters (user_id TEXT PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0, month INTEGER NOT NULL DEFAULT 0, month_key TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS payout_confirmations (id INTEGER PRIMARY KEY AUTOINCREMENT, payout_id INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE, user_id TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS giveaways (message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, prize TEXT NOT NULL, ends_at INTEGER NOT NULL, winners INTEGER NOT NULL DEFAULT 1, ended INTEGER NOT NULL DEFAULT 0, entries TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS moderation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, action TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL);`);
    } catch (error) {
      // Never let schema drift crash-loop the bot on a fresh host — keep core tables, log the gap.
      try { db.exec("CREATE TABLE IF NOT EXISTS giveaways (message_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, prize TEXT NOT NULL, ends_at INTEGER NOT NULL, winners INTEGER NOT NULL DEFAULT 1, ended INTEGER NOT NULL DEFAULT 0, entries TEXT NOT NULL DEFAULT '[]')"); } catch {}
      logger.error('Schema init partially failed — bot continuing with available tables', error);
    }
  },
  getSettings(guildId) { const row = db.prepare('SELECT data FROM guild_settings WHERE guild_id=?').get(guildId); return row ? JSON.parse(row.data) : {}; },
  saveSettings(guildId, data) { db.prepare('INSERT INTO guild_settings(guild_id,data) VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET data=excluded.data').run(guildId, json(data)); },
  case(guildId, userId, moderatorId, action, reason) { return db.prepare('INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at) VALUES(?,?,?,?,?,?)').run(guildId,userId,moderatorId,action,reason,Date.now()).lastInsertRowid; },
  caseWithEvidence(guildId, userId, moderatorId, action, reason, evidence) { return db.prepare('INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,evidence,created_at) VALUES(?,?,?,?,?,?,?)').run(guildId,userId,moderatorId,action,reason,evidence||null,Date.now()).lastInsertRowid; },
  casesFor(guildId, userId, limit = 25) { return db.prepare('SELECT * FROM moderation_cases WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?').all(guildId, userId, limit); },
  panelByMessage(messageId) { return db.prepare('SELECT * FROM ticket_panels WHERE message_id=?').get(messageId); },
  categoriesForPanel(panelId) { return db.prepare('SELECT * FROM ticket_categories WHERE panel_id=? AND disabled=0 ORDER BY id').all(panelId).map(c => ({ ...c, staff_roles: JSON.parse(c.staff_roles || '[]') })); },
  category(key) { const row = db.prepare('SELECT * FROM ticket_categories WHERE key=?').get(key); return row && { ...row, staff_roles: JSON.parse(row.staff_roles || '[]') }; },
  createTicket(guildId, panelId, categoryId, channelId, creatorId) { return db.prepare('INSERT INTO tickets(guild_id,panel_id,category_id,channel_id,creator_id,created_at,last_activity_at) VALUES(?,?,?,?,?,?,?)').run(guildId,panelId,categoryId,channelId,creatorId,Date.now(),Date.now()).lastInsertRowid; },
  ticketByChannel(channelId) { return db.prepare('SELECT * FROM tickets WHERE channel_id=?').get(channelId); },
  openTicketCount(guildId, userId, categoryId) { return db.prepare("SELECT COUNT(*) c FROM tickets WHERE guild_id=? AND creator_id=? AND category_id=? AND status IN ('open','claimed','pending')").get(guildId,userId,categoryId).c; },
  userOpenTickets(guildId, userId) { return db.prepare("SELECT * FROM tickets WHERE guild_id=? AND creator_id=? AND status IN ('open','claimed','pending')").all(guildId,userId); },
  updateTicket(channelId, patch) { const keys = Object.keys(patch); if (!keys.length) return; db.prepare(`UPDATE tickets SET ${keys.map(k => `${k}=?`).join(',')} WHERE channel_id=?`).run(...keys.map(k => patch[k]), channelId); },
  giveaway(messageId) { const row = db.prepare('SELECT * FROM giveaways WHERE message_id=?').get(messageId); return row && { ...row, entries: JSON.parse(row.entries) }; },
  activeGiveaways() { return db.prepare('SELECT * FROM giveaways WHERE ended=0 AND ends_at<=?').all(Date.now()); },
  addGiveawayEntry(messageId, userId) { const row = this.giveaway(messageId); if (!row || row.ended || row.entries.includes(userId)) return false; row.entries.push(userId); db.prepare('UPDATE giveaways SET entries=? WHERE message_id=?').run(JSON.stringify(row.entries), messageId); return true; },
  endGiveaway(messageId, winners) { db.prepare('UPDATE giveaways SET ended=1, entries=? WHERE message_id=?').run(JSON.stringify(winners), messageId); },
  // Vouches
  addVouch(guildId, targetId, authorId, description, dealValue, proofUrl) {
    const key = monthKey();
    const insert = withTransaction(() => {
      const id = db.prepare('INSERT INTO vouches(guild_id,target_id,author_id,description,deal_value,proof_url,created_at) VALUES(?,?,?,?,?,?,?)').run(guildId, targetId, authorId, description || null, dealValue || null, proofUrl || null, Date.now()).lastInsertRowid;
      db.prepare('INSERT INTO vouch_counters(user_id,total,month,month_key) VALUES(?,1,1,?) ON CONFLICT(user_id) DO UPDATE SET total=total+1, month=CASE WHEN month_key=? THEN month+1 ELSE 1 END, month_key=?').run(targetId, key, key, key);
      return id;
    });
    return insert;
  },
  vouchesFor(guildId, userId, limit = 25) { return db.prepare("SELECT * FROM vouches WHERE guild_id=? AND target_id=? AND status='active' ORDER BY id DESC LIMIT ?").all(guildId,userId,limit); },
  vouchesBy(guildId, authorId, limit = 25) { return db.prepare("SELECT * FROM vouches WHERE guild_id=? AND author_id=? AND status='active' ORDER BY id DESC LIMIT ?").all(guildId,authorId,limit); },
  vouchCounter(userId) { return db.prepare('SELECT total,month,month_key FROM vouch_counters WHERE user_id=?').get(userId); },
  topVouched(guildId, limit = 10) { return db.prepare("SELECT target_id, COUNT(*) c FROM vouches WHERE guild_id=? AND status='active' GROUP BY target_id ORDER BY c DESC LIMIT ?").all(guildId,limit); },
  latestVouches(guildId, limit = 10) { return db.prepare("SELECT * FROM vouches WHERE guild_id=? AND status='active' ORDER BY id DESC LIMIT ?").all(guildId,limit); },
  removeVouch(vouchId) { db.prepare("UPDATE vouches SET status='removed' WHERE id=?").run(vouchId); },
  recentVouch(guildId, authorId, targetId, seconds = 120) { return db.prepare("SELECT id FROM vouches WHERE guild_id=? AND author_id=? AND target_id=? AND status='active' AND created_at>=?").get(guildId,authorId,targetId,Date.now()-seconds*1000); },
  // Payouts
  addPayout(userId, type, address, label) { const existing = db.prepare('SELECT * FROM payouts WHERE user_id=? AND type=? AND address=?').get(userId,type,address); if (existing) return existing.id; const isDefault = db.prepare('SELECT COUNT(*) c FROM payouts WHERE user_id=?').get(userId).c === 0 ? 1 : 0; return db.prepare('INSERT INTO payouts(user_id,type,address,label,is_default,confirmed,created_at) VALUES(?,?,?,?,?,0,?)').run(userId,type,address,label||null,isDefault,Date.now()).lastInsertRowid; },
  payoutsFor(userId) { return db.prepare('SELECT * FROM payouts WHERE user_id=? ORDER BY is_default DESC, id DESC').all(userId); },
  defaultPayout(userId) { return db.prepare('SELECT * FROM payouts WHERE user_id=? AND is_default=1').get(userId) || db.prepare('SELECT * FROM payouts WHERE user_id=? ORDER BY is_default DESC, id DESC').get(userId); },
  removePayout(userId, id) { return db.prepare('DELETE FROM payouts WHERE id=? AND user_id=?').run(id, userId).changes; },
  setDefaultPayout(userId, id) { withTransaction(() => { db.prepare('UPDATE payouts SET is_default=0 WHERE user_id=?').run(userId); db.prepare('UPDATE payouts SET is_default=1 WHERE user_id=? AND id=?').run(userId,id); }); return true; },
  markPayoutConfirmed(userId, id) { db.prepare('UPDATE payouts SET confirmed=1, confirm_token=NULL, confirm_expires_at=NULL WHERE id=? AND user_id=?').run(id,userId); },
  // Ticket panels & categories (extended helpers)
  addPanel(guildId, channelId, messageId, title, description) { return db.prepare('INSERT INTO ticket_panels(guild_id,channel_id,message_id,title,description,created_at) VALUES(?,?,?,?,?,?)').run(guildId,channelId,messageId,title,description||null,Date.now()).lastInsertRowid; },
  panelById(id) { return db.prepare('SELECT * FROM ticket_panels WHERE id=?').get(id); },
  panelByMessageId(messageId) { return db.prepare('SELECT * FROM ticket_panels WHERE message_id=?').get(messageId); },
  categoryById(id) { const row = db.prepare('SELECT * FROM ticket_categories WHERE id=?').get(id); return row && { ...row, staff_roles: JSON.parse(row.staff_roles || '[]') }; },
  addCategory(panelId, key, label, description, staffRoles, nameFormat, parentCategoryId, openLimit) { return db.prepare('INSERT OR IGNORE INTO ticket_categories(panel_id,key,label,description,staff_roles,ticket_name_format,parent_category_id,open_limit_per_user) VALUES(?,?,?,?,?,?,?,?)').run(panelId,key,label,description||null,JSON.stringify(staffRoles||[]),nameFormat||'ticket-{username}',parentCategoryId||null,openLimit||1).lastInsertRowid; },
  addField(categoryId, label, style, required, placeholder, choices, minLength, maxLength, position) { return db.prepare('INSERT INTO ticket_form_fields(category_id,label,style,required,placeholder,choices,min_length,max_length,position) VALUES(?,?,?,?,?,?,?,?,?)').run(categoryId,label,style,required?1:0,placeholder||null,choices?JSON.stringify(choices):null,minLength||null,maxLength||null,position||0).lastInsertRowid; },
  clearFields(categoryId) { db.prepare('DELETE FROM ticket_form_fields WHERE category_id=?').run(categoryId); },
  categoryByKeyAndPanel(key, panelId) { const row = db.prepare('SELECT * FROM ticket_categories WHERE key=? AND panel_id=?').get(key, panelId); return row && { ...row, staff_roles: JSON.parse(row.staff_roles || '[]') }; },
  vouchById(id) { return db.prepare('SELECT * FROM vouches WHERE id=?').get(id); },
  audit(guildId, userId, action, data) { db.prepare('INSERT INTO moderation_logs(guild_id,user_id,action,data,created_at) VALUES(?,?,?,?,?)').run(guildId,userId,action,data?JSON.stringify(data):null,Date.now()); },
  staleTickets(cutoffWarn, cutoffClose) { return db.prepare("SELECT * FROM tickets WHERE status IN ('open','claimed') AND last_activity_at < ? AND (last_warned_at IS NULL OR last_activity_at < ?) ORDER BY last_activity_at LIMIT 25").all(cutoffClose, cutoffWarn); },
};

export { db };
function monthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
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
