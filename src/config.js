export const BRAND = 'NIGHTMARE V2.44';
export const COLORS = { primary: 0x17121f, success: 0x8b5cf6, danger: 0xef4444, warning: 0xf59e0b, muted: 0x6b7280 };
export const cooldowns = new Map();
export function isOnCooldown(key, ms = 2500) { const now = Date.now(); const last = cooldowns.get(key) ?? 0; if (now - last < ms) return true; cooldowns.set(key, now); return false; }
