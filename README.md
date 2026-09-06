# SYNSA

Ein lokales Windows-Programm zum Streamen auf Twitch: Alerts, ein Chat-Dashboard und Browser-Quellen für OBS — Alerts, Musik, Countdown und Stream-Ziel.

## Aktueller Stand

<!-- Dieser Abschnitt wird bei jedem Release aktualisiert. -->

- **Aktuelle Version: 0.2.1** ([alle Releases](https://github.com/SynAisa/SYNSA/releases))
- Öffentlich installierbar: ja, der Installer liegt unter [Releases](https://github.com/SynAisa/SYNSA/releases/latest)
- Automatische Updates funktionieren und sind gegen echte Releases getestet; geladen wird nur der geänderte Teil des Installers
- SYNSA ist weiterhin in **aktiver Entwicklung** — zwischen Versionen kann sich Verhalten ändern, und es gibt noch raue Kanten
- **Spotify als zweite Musikquelle** ist im Code vorbereitet (Auswahl in den Einstellungen, OAuth mit PKCE), aber noch nicht nutzbar: dafür fehlt eine registrierte Spotify-Anwendung. Bis dahin steht nur YTMDesktop zur Verfügung.

## Was ist SYNSA?

SYNSA ist eine Windows-Anwendung (Electron), die lokal auf dem eigenen Rechner läuft. Sie verbindet sich mit Twitch, um Alerts und Chat zu empfangen, bietet ein Dashboard zum Steuern des Streams und stellt mehrere Seiten bereit, die in OBS als Browser-Quelle eingebunden werden.

Alles läuft auf deinem Rechner. Es gibt keinen SYNSA-Server: Das Programm spricht direkt mit Twitch, mit der öffentlichen Emote-API von 7TV und — wenn du das Musik-Overlay nutzt — mit der Musik-App auf demselben PC.

## Funktionen

- **Twitch-Alerts** — Follow, Subscription (auch Gift-Subs), Cheer und Raid über Twitch EventSub, mit Warteschlange und Overlay für OBS
- **Chat-Dashboard** — Twitch-Chat live mitlesen, Nachrichten senden, moderieren (Timeout/Ban), Emote-Picker mit deinen Twitch- und 7TV-Emotes, Chatter-Liste mit Rollen
- **Stream-Infos** — Titel und Kategorie direkt aus dem Dashboard ändern
- **Musik-Overlay** — der gerade laufende Song aus der YouTube Music Desktop App (YTMDesktop) über deren lokalen Companion Server
- **Countdown-Overlay** — ein konfigurierbarer „Starting Soon"-Timer
- **Ziel-Overlay** — ein Stream-Ziel aus den eigenen Alerts: Follower, neue Subs, Gift-Subs oder Bits, als Fortschrittsbalken für OBS. Setzt sich automatisch zurück, sobald der Stream live geht
- **Diagnose-Seite** — zeigt auf einen Blick, was läuft und was nicht: Twitch-Verbindung, alle neun EventSub-Abos, welche Overlays in OBS eingerichtet sind, YTMDesktop-Kopplung, Update-Zustand und die lokalen Adressen. Reine Anzeige, keine Knöpfe
- **Deutsch und Englisch** — Deutsch ist die Originalsprache, die Oberflächensprache lässt sich in den Einstellungen umschalten
- **Geführter Rundgang** — erklärt beim ersten Start das Dashboard, jederzeit über die Einstellungen erneut startbar
- **Automatische Updates** — beim Start und auf Wunsch geprüft, nur nach Bestätigung geladen, nie während eines laufenden Streams installiert
- **Tray-Anwendung** — läuft im Windows-Tray, mit Schnellzugriff auf alle Seiten und Overlay-URLs
- **Overlay-Vorschau in den Einstellungen** — jede Overlay-Seite zeigt ihre OBS-URL zum Kopieren, ob die Browser-Quelle gerade in OBS verbunden ist, und eine eingebettete Live-Vorschau im 16:9-Format
- **Moderation im Chatverlauf** — ein erfolgreicher Timeout oder Ban erscheint als eigene, gedämpfte Zeile im Chat
- **Verhalten beim Schließen** — beim Klick auf das X fragt SYNSA, ob es in den Tray soll oder beendet werden — die Antwort lässt sich merken und in den Einstellungen ändern

## Installation

Den Installer gibt es beim [neuesten Release](https://github.com/SynAisa/SYNSA/releases/latest):

- [**SYNSA-Setup.exe**](https://github.com/SynAisa/SYNSA/releases/latest/download/SYNSA-Setup.exe) — dieser Link zeigt immer auf die aktuellste Version

Die Installation braucht Administratorrechte (SYNSA wird für alle Benutzer installiert). Danach startet SYNSA im Tray; der Willkommensbildschirm führt durch die Verknüpfung mit Twitch.

Für die Twitch-Verbindung brauchst du **keine eigene Twitch-Anwendung**. SYNSA ist als öffentlicher Twitch-Client registriert und nutzt den Device-Code-Flow: Du bekommst einen Code, bestätigst ihn auf twitch.tv, fertig. Dein Twitch-Passwort gibst du nie in SYNSA ein.

## Overlays für OBS

Als Browser-Quelle einbinden. Auf jeder Einstellungsseite steht die passende URL mit Kopieren-Knopf.

| Overlay | URL |
| --- | --- |
| Alerts | `http://localhost:4242/overlay.html` |
| Musik | `http://localhost:4242/overlay-music.html` |
| Countdown | `http://localhost:4242/overlay-countdown.html` |
| Ziel | `http://localhost:4242/overlay-goal.html` |

## Updates

SYNSA sucht beim Start und auf Wunsch nach Updates.

- Es wird nichts ohne deine Bestätigung heruntergeladen
- Der Fortschritt ist sichtbar, bevor die Installation angeboten wird
- Während dein Twitch-Stream live ist, wird nie installiert
- Updates werden an Ort und Stelle installiert — Einstellungen, Zugangsdaten und Verlauf bleiben erhalten
- Es wird nur geladen, was sich geändert hat: ein kleines Update überträgt ein bis zwei Megabyte statt der vollen ~107 MB

## Voraussetzungen

- **Windows** (Installer und Verschlüsselung der Zugangsdaten sind Windows-spezifisch)
- Ein **Twitch-Konto** — keine Entwickler-Anwendung, kein Client Secret nötig
- **OBS Studio** (oder ähnlich), um die Overlays anzuzeigen
- **YouTube Music Desktop App (YTMDesktop)** mit aktiviertem Companion Server, nur für das Musik-Overlay

### Twitch-Berechtigungen

SYNSA fragt genau die Berechtigungen ab, die seine Funktionen brauchen — der Einrichtungsbildschirm listet sie in derselben Reihenfolge:

| Berechtigung | Wofür |
| --- | --- |
| `moderator:read:followers` | Follow-Alerts |
| `channel:read:subscriptions` | Subscription- und Gift-Sub-Alerts |
| `bits:read` | Cheer-Alerts |
| `user:read:chat` | Chat mitlesen |
| `user:write:chat` | Chatnachrichten senden |
| `channel:manage:broadcast` | Titel und Kategorie ändern |
| `user:read:emotes` | Emote-Picker |
| `moderator:manage:banned_users` | Timeout und Ban aus dem Dashboard |
| `moderator:read:chatters` | Chatter-Liste |
| `moderation:read` | Moderator-Rollen in der Chatter-Liste |
| `channel:read:vips` | VIP-Rollen in der Chatter-Liste |

## Datenschutz / lokale Daten

- SYNSA ist eine lokale Anwendung und läuft vollständig auf deinem eigenen Rechner.
- **Niemand hat Zugriff auf deine Anmeldedaten — auch der Entwickler von SYNSA nicht.** Deine Twitch-Zugangsdaten, deine Chat-Inhalte und dein Alert-Verlauf verlassen deinen Rechner nicht.
- Du gibst dein Twitch-Passwort nie in SYNSA ein. Du bestätigst die Verbindung auf twitch.tv, und der Zugangsschlüssel, den Twitch danach ausstellt, wird verschlüsselt auf deiner eigenen Festplatte abgelegt (über Electrons `safeStorage`). Für die YouTube-Music-Kopplung gilt dasselbe.
- Alert-Verlauf, Chat-Verlauf und Moduleinstellungen liegen lokal in deinem Benutzerprofil.
- Es gibt keinen Server des Entwicklers. SYNSA spricht ausschließlich mit der Twitch-API und EventSub, mit der öffentlichen 7TV-API für Emotes und mit dem Companion Server der YouTube Music Desktop App auf deinem eigenen Rechner.
- Die Weboberfläche von SYNSA lauscht nur auf den Loopback-Adressen (`127.0.0.1` und `::1`) und ist damit aus deinem Netzwerk nicht erreichbar.

Dieser Abschnitt beschreibt, was die Software technisch tut; er ist keine juristische Datenschutzerklärung.

## Entwicklung

```bash
npm install
npm run electron   # SYNSA im Entwicklungsmodus starten
npm run dist       # Windows-Installer (NSIS) mit electron-builder bauen
```

`server.js` ist der lokale HTTP-/WebSocket-Server, mit dem jede Seite und jedes Overlay spricht; `electron/` ist die Tray-Hülle darum; `twitch/`, `music/`, `spotify/` und `update/` sind die Backend-Module; unter `public/` liegen alle Seiten, Overlays und Stylesheets.

`CLAUDE.md` enthält interne Entwicklungsrichtlinien und Architekturnotizen für die Arbeit an SYNSA mit KI-Unterstützung. Es ist keine Endnutzer-Dokumentation.

## Lizenz

SYNSA ist proprietäre Software. Der Quellcode in diesem Repository ist öffentlich einsehbar, das bedeutet aber **kein** Recht zur Nutzung, Vervielfältigung, Änderung oder Weitergabe. Details in [LICENSE](LICENSE).
