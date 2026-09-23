// Smoke test: import all modules, exercise pure functions. Run with: node scripts/smoke.mjs
process.env.DATABASE_PATH = './data/smoke-test.sqlite';
import fs from 'node:fs';
for (const f of ['data/smoke-test.sqlite', 'data/smoke-test.sqlite-wal', 'data/smoke-test.sqlite-shm']) { try { fs.unlinkSync(f); } catch {} }

const checks = [];
const check = (name, fn) => { try { const result = fn(); checks.push([name, result === false ? 'FAIL' : 'PASS']); } catch (e) { checks.push([name, `ERROR: ${e.message}`]); } };

// Database init
const { database, db } = await import('../src/database/index.js');
check('database.init tables exist', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  return ['vouches', 'tickets', 'ticket_panels', 'ticket_categories', 'ticket_form_fields', 'payouts', 'moderation_cases'].every(t => tables.includes(t));
});

// Vouch flow
check('addVouch + counter', () => {
  const id = database.addVouch('g1', 'u1', 'u2', 'great deal');
  const counter = database.vouchCounter('u1');
  return id > 0 && counter.total === 1;
});
check('month counter increments', () => {
  database.addVouch('g1', 'u1', 'u3', 'another deal');
  return database.vouchCounter('u1').month === 2;
});
check('removeVouch decrements display total', () => {
  const id = database.addVouch('g1', 'u1', 'u2', 'third');
  database.removeVouch(id);
  const active = database.vouchesFor('g1', 'u1');
  return active.length === 2;
});

// Vouch parser
const { parseVouch } = await import('../src/utils/vouch.js');
check('parseVouch valid', () => parseVouch('+rep <@123456789012345678> fast deal, legit seller', '999999999999999999').ok === true);
check('parseVouch self blocked', () => parseVouch('+rep <@999999999999999999> me', '999999999999999999').error === 'self');
check('parseVouch format error', () => parseVouch('+rep no mention', '999999999999999999').error === 'format');
check('parseVouch needs description', () => parseVouch('+rep <@123456789012345678>', '1').error === 'description');

// Validators
const { isValidLtcAddress, isValidSegwitBech32, isValidUpiId } = await import('../src/utils/validate.js');
const { createHash } = await import('node:crypto');

// 1) BIP-173 official test vector with its native HRP 'bc' — pure checksum/witness validation
check('bech32 engine passes official BIP-173 vector (BC1... P2WPKH)', () => isValidSegwitBech32('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'bc') === true);
check('bech32 engine rejects corrupted BIP-173 vector', () => isValidSegwitBech32('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', 'bc') === false);

// 2) Independent BIP-173 reference encoder: build a valid LTC address, expect acceptance
function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) { const top = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i]; }
  return chk;
}
function bech32HrpExpand(hrp) { const r = []; for (const c of hrp) r.push(c.charCodeAt(0) >> 5); r.push(0); for (const c of hrp) r.push(c.charCodeAt(0) & 31); return r; }
function bech32Encode(hrp, data) {
  const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const payload = [...data, ...[0, 1, 2, 3, 4, 5].map(i => (polymod >> 5 * (5 - i)) & 31)];
  return hrp + '1' + payload.map(d => charset[d]).join('');
}
function to5Bit(bytes) { let acc = 0, bits = 0; const out = []; for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out.push((acc >> bits) & 31); } } if (bits) out.push((acc << (5 - bits)) & 31); return out; }
const witHash = createHash('sha256').update('nightmare-test').digest().subarray(0, 20);
const generatedLtc = bech32Encode('ltc', [0, ...to5Bit(witHash)]);
check(`generated valid LTC bech32 address accepted (${generatedLtc})`, () => isValidLtcAddress(generatedLtc) === true);
check('LTC rejects corrupted generated address', () => isValidLtcAddress(generatedLtc.slice(0, -1) + (generatedLtc.endsWith('p') ? 'q' : 'p')) === false);
check('LTC rejects wrong-hrp (btc address)', () => isValidLtcAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4') === false);
check('LTC legacy L-address shape check runs', () => typeof isValidLtcAddress('Lfffffffffffffffffffffffffffffffffffffff') === 'boolean');
check('LTC rejects garbage', () => isValidLtcAddress('hello') === false && isValidLtcAddress('ltc1q') === false);
check('UPI valid', () => isValidUpiId('name@okhdfcbank') === true && isValidUpiId('pay@ybl') === true);
check('UPI invalid', () => isValidUpiId('name@') === false && isValidUpiId('@bank') === false && isValidUpiId('noatsign') === false);

// Ticket helpers
const tickets = await import('../src/utils/tickets.js');
check('panelSelectRow builds empty', () => typeof tickets.panelSelectRow(null, []) === 'object');
check('fieldsForCategory empty', () => Array.isArray(tickets.fieldsForCategory(999999)));
check('isStaffForTicket no category', () => tickets.isStaffForTicket({ permissions: { has: () => false }, roles: { cache: { has: () => false } } }, { category_id: null, guild_id: 'g1' }) === false);

// Payout flow
check('addPayout + default', () => {
  const id = database.addPayout('u9', 'ltc', 'Lffffffffffffffffffffffffffffffffffffffff', null);
  const rows = database.payoutsFor('u9');
  return id > 0 && rows.length === 1 && rows[0].is_default === 1;
});
check('payout remove ownership', () => database.removePayout('u9', 999999) === 0);

// Panel + category + fields flow
check('panel/category/field creation', () => {
  const panelId = database.addPanel('g1', 'c1', 'm1', 'Test panel', 'desc');
  const catId = database.addCategory(panelId, 'billing', 'Billing', 'Billing tickets', ['111'], 'ticket-{username}', null, 1);
  const cat = database.categoryById(catId);
  const fid = database.addField(catId, 'Order ID', 'short', true, 'e.g. 12345', ['A', 'B'], null, null, 0);
  const fields = tickets.fieldsForCategory(catId);
  database.clearFields(catId);
  return cat.staff_roles.includes('111') && fid > 0 && fields.length === 1;
});

// Case system
check('case + history', () => {
  const id = database.caseWithEvidence('g1', 'u1', 'mod1', 'ban', 'spam', 'https://example.com/e.png');
  const cases = database.casesFor('g1', 'u1');
  return id > 0 && cases.some(c => c.evidence === 'https://example.com/e.png');
});

// Command builder serialization: every slash command must build valid Discord payloads
const { commands } = await import('../src/commands/index.js');
check(`command definitions serialize (${commands.length} commands)`, () => {
  const names = new Set();
  for (const c of commands) {
    const json = c.data.toJSON(); // throws if the builder is malformed
    if (names.has(json.name)) throw new Error(`duplicate command: ${json.name}`);
    names.add(json.name);
    if (typeof c.execute !== 'function') throw new Error(`missing execute: ${json.name}`);
  }
  return names.size === commands.length;
});

console.log('\nSmoke test results:');
let failed = 0;
for (const [name, result] of checks) {
  if (result !== 'PASS') failed++;
  console.log(`  ${result === 'PASS' ? '✓' : '✗'} ${name}${result !== 'PASS' ? ` — ${result}` : ''}`);
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll smoke checks passed');
process.exit(failed ? 1 : 0);
