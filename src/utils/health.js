// Minimal HTTP health endpoint so the Freebuff preview can verify the bot process is up.
// Also serves saved ticket transcripts at /transcripts/<file>.html (no directory listing).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

const state = { discordConnected: false, reason: null };

export function setDiscordState(connected, reason = null) {
  state.discordConnected = connected;
  state.reason = reason;
}

export function startHealthServer(port = Number(process.env.PORT) || 3000) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health' || url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, service: 'nightmare-v2-44', discord: state.discordConnected, reason: state.reason, uptime: process.uptime() }));
    }
    if (url.pathname.startsWith('/transcripts/')) {
      const name = path.basename(url.pathname); // prevent traversal
      const file = path.join(process.cwd(), 'data', 'transcripts', name);
      if (fs.existsSync(file) && file.endsWith('.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return fs.createReadStream(file).pipe(res);
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
  server.listen(port, '0.0.0.0', () => logger.info(`Health server listening on 0.0.0.0:${port}`));
  server.on('error', error => logger.error('Health server error', error));
  return server;
}
