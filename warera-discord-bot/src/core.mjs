import { randomBytes, createPublicKey, verify } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const offices = {
  president: 'Präsident', vicePresident: 'Vizepräsident',
  minOfDefense: 'Verteidigungsminister', minOfEconomy: 'Wirtschaftsminister',
  minOfForeignAffairs: 'Außenminister',
};
export function desiredRoles(user, countries, government) {
  const country = countries.find(c => c._id === user.country);
  if (!country || !government || !Object.keys(offices).some(k => k in government)) {
    throw new Error('Unvollständige Länder-/Regierungsdaten. Rollen bleiben unverändert.');
  }
  if (government.country != null && government.country !== user.country) throw new Error('Regierungsdaten gehören zu einem anderen Land.');
  const result = [['verified', 'WarEra: Verifiziert'], [`country:${country._id}`, `Land: ${country.name}`]];
  for (const [field, label] of Object.entries(offices)) {
    const value = government[field];
    if (value != null && typeof value !== 'string') throw new Error('Unbekanntes Regierungsdatenformat.');
    if (value === user._id) result.push([`office:${field}`, `Amt: ${label}`]);
  }
  return result;
}
export function validSignature(publicKey, signature, timestamp, body, now = Date.now()) {
  try {
    if (!/^[a-f0-9]{64}$/i.test(publicKey) || !/^[a-f0-9]{128}$/i.test(signature ?? '') ||
        !/^\d+$/.test(timestamp ?? '') || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
    const key = createPublicKey({ key: Buffer.from('302a300506032b6570032100' + publicKey, 'hex'), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'));
  } catch { return false; }
}
export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS links (guild TEXT, discord TEXT, game TEXT, PRIMARY KEY(guild,discord), UNIQUE(guild,game));
      CREATE TABLE IF NOT EXISTS challenges (guild TEXT, discord TEXT, game TEXT, token TEXT, expires INTEGER, PRIMARY KEY(guild,discord));
      CREATE TABLE IF NOT EXISTS roles (guild TEXT, key TEXT, role TEXT, PRIMARY KEY(guild,key));
      CREATE TABLE IF NOT EXISTS settings (guild TEXT PRIMARY KEY, military INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER, expires INTEGER);
      CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, expires INTEGER);`);
  }
  limit(key, max, now = Date.now()) {
    this.db.prepare('DELETE FROM limits WHERE expires < ?').run(now);
    const row = this.db.prepare('SELECT * FROM limits WHERE key=?').get(key);
    if (row?.count >= max) throw new Error('Zu viele Versuche. Bitte innerhalb einer Stunde erneut versuchen.');
    this.db.prepare(`INSERT INTO limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1`).run(key, now + 3600000);
  }
  once(id) {
    this.db.prepare('DELETE FROM seen WHERE expires < ?').run(Date.now());
    return this.db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(id, Date.now() + 600000).changes === 1;
  }
  start(guild, discord, game, now = Date.now()) {
    const existing = this.db.prepare('SELECT * FROM links WHERE guild=? AND (discord=? OR game=?)').get(guild, discord, game);
    if (existing) throw new Error('Discord- oder Spielaccount ist bereits verknüpft. Nutze /synchronisieren.');
    const token = 'WV-' + randomBytes(16).toString('hex').toUpperCase();
    this.db.prepare('INSERT OR REPLACE INTO challenges VALUES(?,?,?,?,?)').run(guild, discord, game, token, now + 900000);
    return token;
  }
  challenge(guild, discord, now = Date.now()) {
    const row = this.db.prepare('SELECT * FROM challenges WHERE guild=? AND discord=?').get(guild, discord);
    if (!row || row.expires <= now) throw new Error('Code abgelaufen oder nicht vorhanden. Starte erneut.');
    return row;
  }
  complete(challenge, now = Date.now()) {
    const current = this.challenge(challenge.guild, challenge.discord, now);
    if (current.token !== challenge.token) throw new Error('Code wurde inzwischen ersetzt.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO links VALUES(?,?,?)').run(current.guild, current.discord, current.game);
      this.db.prepare('DELETE FROM challenges WHERE guild=? AND discord=?').run(current.guild, current.discord);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw new Error('Account bereits verknüpft.', { cause: error }); }
  }
}
