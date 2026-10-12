import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store, validSignature } from './core.mjs';
import { Api } from './api.mjs';
import { Service } from './service.mjs';

for (const name of ['DISCORD_APP_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_BOT_TOKEN']) {
  if (!process.env[name]) throw new Error(`${name} fehlt in .env`);
}
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const store = new Store(fileURLToPath(new URL('../data/bot.sqlite', import.meta.url)));
const api = new Api();
const service = new Service(store, api);
let queue = Promise.resolve(), pending = 0;
function enqueue(job) {
  pending++;
  queue = queue.then(job).catch(error => console.error('Aufgabe fehlgeschlagen:', error.message)).finally(() => pending--);
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
const privateMessage = content => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
    if (req.method !== 'POST' || req.url !== '/interactions') return send(res, 404, {});
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) return send(res, 413, {});
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (!validSignature(process.env.DISCORD_PUBLIC_KEY, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'], body)) return send(res, 401, {});
    const i = JSON.parse(body);
    if (i.type === 1) return send(res, 200, { type: 1 });
    if (i.application_id !== process.env.DISCORD_APP_ID || !i.guild_id || !i.member?.user?.id) return send(res, 200, privateMessage('Bitte auf einem Discord-Server verwenden.'));
    if (i.type === 3 && i.data.custom_id === 'verify-open') {
      return send(res, 200, { type: 9, data: { custom_id: 'verify-submit', title: 'WarEra-Account verifizieren', components: [
        { type: 1, components: [{ type: 4, custom_id: 'account', label: 'Spieler-ID oder Profil-Link', style: 1, required: true, max_length: 100 }] },
      ] } });
    }
    if (![2, 3, 5].includes(i.type)) return send(res, 200, privateMessage('Interaktion nicht unterstützt.'));
    if (pending >= 10) return send(res, 200, privateMessage('Der Bot ist gerade ausgelastet. Bitte später erneut versuchen.'));
    if (!store.once(i.id)) return send(res, 200, privateMessage('Diese Anfrage wurde bereits angenommen.'));
    send(res, 200, { type: 5, data: { flags: 64 } });
    enqueue(async () => {
      let result;
      try { result = await service.handle(i); }
      catch (error) { result = { content: error.message }; }
      await api.discord(`/webhooks/${process.env.DISCORD_APP_ID}/${i.token}/messages/@original`, 'PATCH', { ...result, allowed_mentions: { parse: [] } }, false);
    });
  } catch { if (!res.headersSent) send(res, 400, {}); }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const interval = Number(process.env.SYNC_MINUTES ?? 15);
if (!Number.isFinite(interval) || interval < 5) throw new Error('SYNC_MINUTES muss mindestens 5 sein.');
let syncing = false;
function syncAll() {
  if (syncing) return;
  syncing = true;
  // Queue one member at a time so user interactions can run between members.
  const rows = store.db.prepare('SELECT * FROM links').all();
  let index = 0;
  function next() {
    if (index >= rows.length) { syncing = false; return; }
    const row = rows[index++];
    enqueue(async () => {
      try { await service.sync(row.guild, row.discord); }
      catch (error) { console.error(`Abgleich ${row.guild}/${row.discord}: ${error.message}`); }
      finally { setImmediate(next); }
    });
  }
  next();
}
setInterval(syncAll, interval * 60000).unref();
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => {
  console.log('WarEra-Bot bereit. Discord-Endpunkt: /interactions');
  syncAll();
});
