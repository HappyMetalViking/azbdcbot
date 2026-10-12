import { desiredRoles } from './core.mjs';

export class Service {
  constructor(store, api) { this.store = store; this.api = api; }
  async sync(guild, discord) {
    const link = this.store.db.prepare('SELECT * FROM links WHERE guild=? AND discord=?').get(guild, discord);
    if (!link) throw new Error('Bitte zuerst /verifizieren ausführen.');
    const user = await this.api.user(link.game);
    const countries = await this.api.game('country.getAllCountries');
    const government = await this.api.game('government.getByCountryId', { countryId: user.country });
    const wanted = desiredRoles(user, countries, government);
    const military = this.store.db.prepare('SELECT military FROM settings WHERE guild=?').get(guild)?.military !== 0;
    if (military && user.mu != null) {
      if (typeof user.mu !== 'string' || !user.mu) throw new Error('Ungültige militärische Einheit. Rollen bleiben unverändert.');
      const unit = await this.api.game('mu.getById', { muId: user.mu });
      if (unit?._id !== user.mu || typeof unit.name !== 'string' || !unit.name.trim()) throw new Error('Militärische Einheit nicht verfügbar. Rollen bleiben unverändert.');
      wanted.push([`mu:${unit._id}`, `Einheit: ${unit.name}`]);
    }
    const member = await this.api.discord(`/guilds/${guild}/members/${discord}`);
    const live = await this.api.discord(`/guilds/${guild}/roles`);
    const desired = [];
    for (const [key, name] of wanted) {
      let mapping = this.store.db.prepare('SELECT role FROM roles WHERE guild=? AND key=?').get(guild, key);
      if (!mapping || !live.some(r => r.id === mapping.role)) {
        const role = await this.api.discord(`/guilds/${guild}/roles`, 'POST', { name: name.slice(0, 100), permissions: '0', mentionable: false });
        this.store.db.prepare('INSERT OR REPLACE INTO roles VALUES(?,?,?)').run(guild, key, role.id);
        mapping = { role: role.id };
      } else if (key.startsWith('mu:') && live.find(r => r.id === mapping.role).name !== name.slice(0, 100)) {
        await this.api.discord(`/guilds/${guild}/roles/${mapping.role}`, 'PATCH', { name: name.slice(0, 100) });
      }
      desired.push(mapping.role);
    }
    const managed = this.store.db.prepare('SELECT role FROM roles WHERE guild=?').all(guild).map(r => r.role);
    // Individual changes preserve unrelated roles, including changes by other bots.
    for (const role of member.roles.filter(id => managed.includes(id) && !desired.includes(id))) {
      await this.api.discord(`/guilds/${guild}/members/${discord}/roles/${role}`, 'DELETE');
    }
    for (const role of desired.filter(id => !member.roles.includes(id))) {
      await this.api.discord(`/guilds/${guild}/members/${discord}/roles/${role}`, 'PUT');
    }
    return `Rollen aktualisiert: ${wanted.map(([, name]) => name).join(', ')}.`;
  }
  async handle(i) {
    const guild = i.guild_id, discord = i.member.user.id;
    const command = i.data.name ?? i.data.custom_id;
    if (command === 'config') {
      const permissions = BigInt(i.member.permissions ?? '0');
      if ((permissions & 32n) === 0n && (permissions & 8n) === 0n) throw new Error('Du benötigst „Server verwalten“.');
      const option = i.data.options?.[0];
      if (option?.name === 'botname') {
        const name = option.options?.find(o => o.name === 'name')?.value;
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 32) throw new Error('Der Name muss 1 bis 32 Zeichen lang sein.');
        await this.api.discord(`/guilds/${guild}/members/@me`, 'PATCH', { nick: name.trim() });
        return { content: `Mein Anzeigename auf diesem Server lautet jetzt: ${name.trim()}` };
      }
      if (option?.name === 'militaer') {
        const enabled = option.options?.find(o => o.name === 'aktiv')?.value;
        if (typeof enabled !== 'boolean') throw new Error('Bitte aktiv auf wahr oder falsch setzen.');
        this.store.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(guild) DO UPDATE SET military=excluded.military').run(guild, Number(enabled));
        return { content: enabled ? 'Einheiten-Abgleich aktiviert. Rollen werden beim nächsten Abgleich aktualisiert.' : 'Einheiten-Abgleich deaktiviert. Zugewiesene Einheitenrollen werden beim nächsten Abgleich entfernt; die Rollen selbst bleiben bestehen.' };
      }
      if (option?.name === 'anzeigen') {
        const enabled = this.store.db.prepare('SELECT military FROM settings WHERE guild=?').get(guild)?.military !== 0;
        return { content: `Einheiten-Abgleich: ${enabled ? 'aktiv' : 'inaktiv'}. Automatischer Abgleich: ${this.api.env?.SYNC_MINUTES ?? 15} Minuten. Länder und Regierungsämter: aktiv.` };
      }
      throw new Error('Unbekannte Konfiguration.');
    }
    if (command === 'verifizieren' || command === 'verify-submit') {
      this.store.limit(`start:${guild}:${discord}`, 5);
      const value = i.data.options?.find(o => o.name === 'spielaccount')?.value ?? i.data.components?.[0]?.components?.[0]?.value;
      const match = String(value ?? '').trim().match(/^(?:https:\/\/app\.warera\.io\/user\/)?([a-f0-9]{24})\/?$/i);
      if (!match) throw new Error('Bitte die WarEra-Spieler-ID oder https://app.warera.io/user/DEINE_ID eingeben.');
      const user = await this.api.user(match[1].toLowerCase());
      const token = this.store.start(guild, discord, user._id);
      return { content: `Benenne eine deiner WarEra-Firmen vorübergehend exakt in diesen Code um:\n\`${token}\`\nDer Code gilt 15 Minuten. Klicke danach auf Bestätigen. Anschließend kannst du den alten Firmennamen wiederherstellen.`, components: [buttons(['confirm', 'Bestätigen'])] };
    }
    if (command === 'confirm') {
      this.store.limit(`confirm:${guild}:${discord}`, 15);
      const challenge = this.store.challenge(guild, discord);
      if (!await this.api.proof(challenge.game, challenge.token)) throw new Error('Code in keiner eigenen Firma gefunden. Prüfe den Firmennamen und versuche es erneut.');
      this.store.complete(challenge);
      try { return { content: `Account verifiziert. ${await this.sync(guild, discord)}`, components: [] }; }
      catch (error) { return { content: `Account verifiziert, Rollen noch nicht aktualisiert: ${error.message} Nutze /synchronisieren.`, components: [] }; }
    }
    if (command === 'synchronisieren') {
      this.store.limit(`sync:${guild}:${discord}`, 10);
      return { content: await this.sync(guild, discord) };
    }
    if (command === 'verifizierung-panel') {
      if ((BigInt(i.member.permissions ?? '0') & 32n) === 0n && (BigInt(i.member.permissions ?? '0') & 8n) === 0n) throw new Error('Du benötigst „Server verwalten“.');
      await this.api.discord(`/channels/${i.channel_id}/messages`, 'POST', {
        content: '**WarEra-Verifizierung**\nVerknüpfe deinen Spielaccount und erhalte automatisch deine Länder-, Regierungs- und aktivierten Einheitenrollen.',
        components: [buttons(['verify-open', 'Verifizieren'])], allowed_mentions: { parse: [] },
      });
      return { content: 'Verifizierungspanel erstellt.' };
    }
    throw new Error('Unbekannter Befehl.');
  }
}
export function buttons([id, label]) { return { type: 1, components: [{ type: 2, style: 1, custom_id: id, label }] }; }
