import { Api } from './api.mjs';
for (const name of ['DISCORD_APP_ID', 'DISCORD_BOT_TOKEN']) if (!process.env[name]) throw new Error(`${name} fehlt.`);
const commands = [
  { name: 'verifizieren', description: 'Verknüpfe deinen WarEra-Account', options: [{ name: 'spielaccount', description: 'WarEra-Spieler-ID oder Profil-Link', type: 3, required: true }] },
  { name: 'synchronisieren', description: 'Aktualisiere deine Länder-, Regierungs- und Einheitenrollen' },
  { name: 'config', description: 'Konfiguriere den WarEra-Bot für diesen Server', default_member_permissions: '32', options: [
    { name: 'botname', description: 'Ändere den Anzeigenamen des Bots auf diesem Server', type: 1, options: [{ name: 'name', description: 'Neuer Bot-Anzeigename', type: 3, required: true, min_length: 1, max_length: 32 }] },
    { name: 'militaer', description: 'Aktiviere oder deaktiviere den Einheiten-Abgleich', type: 1, options: [{ name: 'aktiv', description: 'Einheitenrollen automatisch abgleichen', type: 5, required: true }] },
    { name: 'anzeigen', description: 'Zeige die aktuellen Einstellungen', type: 1 },
  ] },
  { name: 'verifizierung-panel', description: 'Erstellt ein Verifizierungspanel in diesem Kanal', default_member_permissions: '32' },
];
const scope = process.env.DISCORD_GUILD_ID ? `/guilds/${process.env.DISCORD_GUILD_ID}` : '';
const api = new Api();
for (const command of commands) {
  await api.discord(`/applications/${process.env.DISCORD_APP_ID}${scope}/commands`, 'POST', {
    ...command, ...(!scope ? { contexts: [0], integration_types: [0] } : {}),
  });
}
console.log(`${commands.length} Befehle registriert.`);
console.log(`Einladung: https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=335547392`);
