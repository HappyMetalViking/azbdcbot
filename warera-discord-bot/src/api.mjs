import { setTimeout as sleep } from 'node:timers/promises';

export class Api {
  constructor(env = process.env, request = fetch) { this.env = env; this.request = request; this.nextGame = 0; }
  async game(procedure, input = {}) {
    await sleep(Math.max(0, this.nextGame - Date.now()));
    this.nextGame = Date.now() + 400;
    const url = new URL(`https://api2.warera.io/trpc/${procedure}`);
    url.searchParams.set('input', JSON.stringify(input));
    const headers = { Accept: 'application/json' };
    if (this.env.WARERA_API_KEY) headers['x-api-key'] = this.env.WARERA_API_KEY;
    const response = await this.request(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`WarEra nicht verfügbar (HTTP ${response.status}). Bitte später erneut versuchen.`);
    const body = await response.json();
    if (body.error || body.result?.data === undefined) throw new Error('WarEra lieferte keine gültigen Daten.');
    return body.result.data?.json ?? body.result.data;
  }
  async discord(path, method = 'GET', body, auth = true) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await this.request(`https://discord.com/api/v10${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
      });
      if (response.status === 429) {
        const data = await response.json();
        await sleep(Math.min(60000, Math.max(1000, Number(data.retry_after) * 1000 || 1000)));
        continue;
      }
      if (!response.ok) throw new Error(`Discord HTTP ${response.status}: Rechte, Rollenhierarchie und Rollenlimit prüfen.`);
      return response.status === 204 ? null : response.json();
    }
    throw new Error('Discord-Ratelimit erreicht. Bitte später erneut versuchen.');
  }
  async user(id) {
    const u = await this.game('user.getUserById', { userId: id });
    if (u?._id !== id || typeof u.country !== 'string') throw new Error('Spielaccount nicht gefunden oder unvollständig.');
    return u;
  }
  async proof(userId, token) {
    let cursor;
    const deadline = Date.now() + 60000;
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const list = await this.game('company.getCompanies', { userId, perPage: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(list?.items)) throw new Error('Ungültige Firmenliste.');
      for (const entry of list.items) {
        if (Date.now() > deadline) throw new Error('Firmenprüfung dauerte zu lange. Benenne eine kürzlich aktualisierte Firma um und versuche es erneut.');
        const companyId = typeof entry === 'string' ? entry : entry._id;
        if (!companyId) throw new Error('Ungültige Firmen-ID.');
        const company = await this.game('company.getById', { companyId });
        if (company._id === companyId && company.user === userId && company.name?.split(/\s+/).includes(token)) return true;
      }
      cursor = list.nextCursor;
      if (!cursor) return false;
      if (seen.has(cursor)) throw new Error('Fehler bei der Firmen-Paginierung.');
      seen.add(cursor);
    }
    throw new Error('Zu viele Firmen für eine Prüfung.');
  }
}
