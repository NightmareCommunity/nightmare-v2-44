import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const dependency of ['discord.js', 'dotenv', 'better-sqlite3']) if (!pkg.dependencies?.[dependency]) throw new Error(`Missing dependency: ${dependency}`);
console.log('NIGHTMARE V2.44 source validation build passed. Run npm run check for syntax validation.');
