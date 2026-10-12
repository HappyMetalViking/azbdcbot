# WarEra Discord Bot

Eigenständiges Node.js-Projekt für alle WarEra-Länder. Keine npm-Abhängigkeiten.
Der Ordner kann komplett an einen anderen Ort verschoben werden; er verwendet keine Dateien des Market Prediction Tools.

## Funktionen

- Verifizierung über einen zufälligen, einmaligen Code im eigenen Firmennamen, 15 Minuten gültig.
- Ein Spielaccount pro Discord-Nutzer und Server, ein Discord-Nutzer pro Spielaccount und Server.
- Länder werden aus WarEra geladen. Länderrollen entstehen beim ersten verifizierten Mitglied dieses Landes.
- Rollen: `WarEra: Verifiziert`, `Land: Germany` usw. sowie gemeinsame Amtsrollen für Präsident, Vizepräsident, Verteidigungsminister, Wirtschaftsminister und Außenminister.
- Regierungsämter werden für das Land der aktuellen Staatsbürgerschaft geprüft. Kongressmandate sind keine Amtsrollen in dieser Version.
- Automatischer Abgleich alle 15 Minuten, zusätzlich `/synchronisieren`.
- Militärische Mitgliedschaft als `Einheit: NAME`, standardmäßig aktiv. Wechsel und Austritt entfernen die alte Zuordnung. Umbenennungen im Spiel aktualisieren den Rollennamen. Ränge innerhalb der Einheit werden nicht vergeben.
- Nur vom Bot angelegte und in SQLite gespeicherte Rollen werden verwaltet. Rollen haben bei Erstellung keine Berechtigungen.
- Bei fehlgeschlagenen WarEra-Abfragen werden keine Rollen geändert. Discord-Fehler können einen teilweise ausgeführten Abgleich hinterlassen; der nächste Abgleich versucht ihn erneut.

## Einrichtung

1. Node.js 24 oder neuer installieren. Diesen Ordner als Arbeitsverzeichnis öffnen.
2. `.env.example` als `.env` kopieren.
3. Im [Discord Developer Portal](https://discord.com/developers/applications) eine Anwendung mit Bot erstellen. Application ID, Public Key und Bot Token lokal in `.env` eintragen. Token nicht im Chat teilen.
4. Den Bot dauerhaft auf einem Host mit beschreibbarem Datenträger betreiben. Ein HTTPS-Reverse-Proxy muss `/interactions` zum Node-Port 3000 weiterleiten. Für einen lokalen Test ist auch ein HTTPS-Tunnel möglich.
5. `node --env-file=.env src/server.mjs` starten. Im Developer Portal die Interactions Endpoint URL auf `https://DEINE-DOMAIN/interactions` setzen. Der Endpunkt prüft Discord-Signaturen.
6. `node --env-file=.env src/register.mjs` ausführen. Optional `DISCORD_GUILD_ID` für sofortige Registrierung auf einem Testserver setzen. Ohne diese Variable werden globale Befehle registriert.
7. Den ausgegebenen Einladungslink verwenden. Er fordert „Rollen verwalten“, „Kanäle ansehen“ und „Nachrichten senden“ an. Die Bot-Rolle muss über seinen Länder- und Amtsrollen stehen. Keine Administratorrechte nötig.
8. Als Servermanager `/verifizierung-panel` im gewünschten Kanal aufrufen. Mitglieder können den Button oder `/verifizieren spielaccount:PROFIL_LINK` nutzen.

Die API-ID findet man im WarEra-Profillink `https://app.warera.io/user/…`. Ein Spieler benötigt eine eigene umbenennbare Firma. Ein alternativer Nachweis ohne Firma ist noch nicht implementiert.

## Konfigurationsbefehle

Benötigen „Server verwalten“ oder Administratorrechte:

- `/config botname name:WarEra Helfer`: ändert den Bot-Nickname auf diesem Server. Der globale Bot-Benutzername und der Anwendungsname werden im Developer Portal geändert. Der Bot benötigt zusätzlich „Nickname ändern“; der neue Einladungslink fordert diese Berechtigung an.
- `/config militaer aktiv:true` bzw. `aktiv:false`: aktiviert/deaktiviert den Einheiten-Abgleich pro Server. Die Einstellung wird in SQLite gespeichert. Bei Deaktivierung entfernt der nächste erfolgreiche Abgleich die Einheitenrollen von verknüpften Mitgliedern; die Rollen selbst bleiben bestehen.
- `/config anzeigen`: zeigt Einheiten-Einstellung und Prüfintervall. Für sofortige Aktualisierung der eigenen Rollen `/synchronisieren` verwenden.

Nach dem Update den Bot neu starten und `node --env-file=.env src/register.mjs` erneut ausführen. Bestehende Datenbanken erhalten die Einstellungstabelle automatisch. Die Bot-Rolle muss auch über den Einheitenrollen stehen. Namen von Einheitenrollen werden automatisch aus dem Spiel übernommen und lokale Umbenennungen beim nächsten Abgleich überschrieben.

## Betrieb und Tests

```powershell
node --test
node --env-file=.env src/server.mjs
```

Nur eine Bot-Instanz pro Datenbank betreiben. `data/bot.sqlite` einschließlich WAL-Dateien konsistent sichern, am einfachsten bei gestopptem Prozess. Die Datenbank enthält Accountverknüpfungen, Rollenzuordnungen und kurzlebige Codes. Ohne sie können alte Rollen nicht zugeordnet werden. Zugang zum Datenverzeichnis beschränken.

Der Server verwendet Discord-HTTP-Interaktionen, keine Gateway-Verbindung; eine Offline-Anzeige des Bot-Profils ist daher kein zuverlässiger Funktionsindikator. `/health` prüft nur den laufenden Prozess. Es werden keine privilegierten Gateway-Intents benötigt.

Rollennamen können nach Erstellung in Discord geändert werden; die Zuordnung verwendet IDs. Vorhandene gleichnamige Rollen werden absichtlich nicht automatisch übernommen. Neue Länderrollen entstehen nach Bedarf, um das Discord-Rollenlimit zu schonen. Bei ausgeschöpftem Rollenlimit bleibt die Accountverknüpfung erhalten und die Rollenvergabe meldet einen Fehler.

Tests prüfen Signaturen, Ablauf und Einmaligkeit von Codes, Account-Eindeutigkeit, Besitznachweis, Pagination, Rollenwechsel und Verhalten bei API-Ausfällen. Ein vollständiger Discord-Livetest benötigt eine konfigurierte Anwendung und einen Testserver.

## Schnittstellen

- [Offizielle WarEra-API](https://api2.warera.io/docs/) und [OpenAPI](https://api2.warera.io/openapi.json)
- [Discord HTTP-Interaktionen](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Referenz für den Firmennamen-Nachweis](https://github.com/lundgrenwarera/warera-discord-verify-bot)

WarEra-Antwortformate wurden am 12.10.2026 anhand öffentlicher Live-Abfragen geprüft. Änderungen der Spiel-API können Anpassungen erfordern.
