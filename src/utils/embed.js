import { EmbedBuilder } from 'discord.js';
import { BRAND, COLORS } from '../config.js';
export const embed = (title, description, color = COLORS.primary) => new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text: BRAND }).setTimestamp();
export const ok = (text) => embed('✓ Success', text, COLORS.success);
export const fail = (text) => embed('✕ Error', text, COLORS.danger);
