// English translation of SYNSA's interface.
//
// The keys are the German original wording, exactly as it stands in the HTML
// and in the scripts — German is the source language and stays there. Adding
// a feature therefore never requires touching this file first: the new German
// text simply shows up untranslated in English until a line is added here,
// which is the intended behaviour while a translation catches up.
//
// Keys are written as one line with single spaces even where the markup wraps
// them across several indented lines; shared/i18n.js normalises whitespace
// before looking a string up.
window.SynsaTranslationsEn = {
  // --- Shared: navigation, status line, update banner ------------------------
  Dashboard: 'Dashboard',
  'Music-Overlay': 'Music overlay',
  Countdown: 'Countdown',
  'Test-Alerts / Control-Panel': 'Test alerts / control panel',
  Einstellungen: 'Settings',
  'Über SYNSA': 'About SYNSA',
  Module: 'Modules',
  Zurück: 'Back',
  Vorwärts: 'Forward',

  'Verbinde…': 'Connecting…',
  'SYNSA verbunden': 'SYNSA connected',
  'SYNSA getrennt – neuer Versuch …': 'SYNSA disconnected – retrying…',
  'Diese Seite ist mit SYNSA verbunden und wird live aktualisiert. Sagt nichts über die Twitch-Verbindung aus.':
    'This page is connected to SYNSA and updates live. It says nothing about the Twitch connection.',
  'Diese Seite hat gerade keine Verbindung zu SYNSA und zeigt womöglich veraltete Werte. Sagt nichts über die Twitch-Verbindung aus.':
    'This page currently has no connection to SYNSA and may be showing outdated values. It says nothing about the Twitch connection.',

  'Wichtiges Update': 'Important update',
  'SYNSA {v} verfügbar': 'SYNSA {v} available',
  'SYNSA {v} wird heruntergeladen': 'Downloading SYNSA {v}',
  'Änderungen anzeigen': 'Show changes',
  Später: 'Later',
  'Jetzt aktualisieren': 'Update now',
  'Jetzt installieren': 'Install now',
  'Erneut versuchen': 'Try again',
  'Eine neue Version ist verfügbar.': 'A new version is available.',
  'Das Update wurde heruntergeladen.': 'The update has been downloaded.',
  'Das Update kann während eines laufenden Streams nicht installiert werden.':
    'The update cannot be installed while a stream is live.',
  'SYNSA wird neu gestartet …': 'Restarting SYNSA…',
  'Aktualisierung wird abgeschlossen. SYNSA wird gleich neu gestartet.':
    'Finishing the update. SYNSA will restart in a moment.',

  // Musikquelle / Spotify
  'Zeigt den gerade laufenden Song als Overlay in OBS. Als Quelle dient wahlweise die':
    'Shows the currently playing song as an overlay in OBS. The source is either',
  '(YTMDesktop, mit aktiviertem Companion Server unter Einstellungen → Integrationen) oder':
    '(YTMDesktop, with its Companion Server enabled under Settings → Integrations) or',
  Musikquelle: 'Music source',
  'Woher kommt der aktuelle Song': 'Where the current song comes from',
  'Es ist immer nur eine Quelle aktiv. Das Overlay bleibt dasselbe.':
    'Only one source is active at a time. The overlay stays the same.',
  'YTMDesktop-Verbindung': 'YTMDesktop connection',
  'Spotify-Verbindung': 'Spotify connection',
  'Mit Spotify verbinden': 'Connect with Spotify',
  'Die Bestätigung läuft im Browser auf spotify.com. Dein Passwort gibst du nie in SYNSA ein.':
    'You confirm the connection in your browser on spotify.com. You never type your password into SYNSA.',
  'Bestätige die Verbindung im Browser. Danach kannst du hierher zurückkehren.':
    'Confirm the connection in your browser, then come back here.',
  'Verknüpft, wartet auf Wiedergabe': 'Linked, waiting for playback',
  'Für Spotify ist in dieser SYNSA-Installation keine Client-ID hinterlegt — bis dahin steht nur YTMDesktop zur Verfügung.':
    'This SYNSA installation has no Spotify client ID configured — until it does, only YTMDesktop is available.',
  'Musikquelle konnte nicht gewechselt werden.': 'Could not switch the music source.',
  'Spotify-Anmeldung konnte nicht gestartet werden.': 'Could not start the Spotify sign-in.',

  // Fenster-Einstellung (Schließen-Verhalten)
  Fenster: 'Window',
  'Beim Klick auf das X': 'When you click the X',
  'Jedes Mal fragen': 'Ask every time',
  'In den Tray minimieren': 'Minimise to the tray',
  'SYNSA beenden': 'Quit SYNSA',
  'Im Tray läuft SYNSA weiter — Alerts, Chat und die Overlays in OBS bleiben aktiv.':
    'In the tray SYNSA keeps running — alerts, chat and the overlays in OBS stay active.',

  // Overlay-Kopfbereich + eingebettete Vorschau
  // ("Kopieren", "Kopiert", "Vorschau", "Nicht verbunden" und
  // "Zuletzt gesehen" stehen bereits weiter unten in dieser Tabelle.)
  'Overlay-URL für OBS': 'Overlay URL for OBS',
  'In OBS verbunden': 'Connected in OBS',
  'In OBS verbunden ({n})': 'Connected in OBS ({n})',
  'Overlay-Vorschau': 'Overlay preview',
  'Breite anpassen — Doppelklick setzt zurück': 'Adjust width — double-click resets',
  'Soll SYNSA im Hintergrund weiterlaufen?': 'Should SYNSA keep running in the background?',
  'Im Tray läuft SYNSA weiter: Alerts, Chat und die Overlays in OBS bleiben aktiv. Beim Beenden hören sie auf zu funktionieren, bis du SYNSA wieder startest.':
    'In the tray SYNSA keeps running: alerts, chat and the overlays in OBS stay active. Quitting stops them until you start SYNSA again.',
  'Diese Wahl merken': 'Remember this choice',
  'Im Tray weiterlaufen': 'Keep running in the tray',
  'Neu in dieser Version': 'New in this version',
  'Spotify (noch nicht verfügbar)': 'Spotify (not available yet)',
  '(in Vorbereitung).': '(in preparation).',
  'Spotify ist vorbereitet, aber noch nicht freigeschaltet: dafür muss eine Spotify-Anwendung für SYNSA registriert sein. Bis dahin läuft das Overlay über YTMDesktop.':
    'Spotify is prepared but not enabled yet: it needs a Spotify application registered for SYNSA. Until then the overlay runs on YTMDesktop.',
  'Das ist die echte Overlay-Seite, eingebettet — sie zeigt live denselben Stand wie in OBS. Solange nichts läuft, steht hier ein Beispiel.':
    'This is the real overlay page, embedded — it shows the same live state as OBS does. While nothing is running, a sample is shown here.',

  // Moderationszeilen im Chat
  '{name} wurde gebannt.': '{name} was banned.',
  '{name} wurde für {d} stumm geschaltet.': '{name} was timed out for {d}.',
  '1 Sekunde': '1 second',
  '{n} Sekunden': '{n} seconds',
  '1 Minute': '1 minute',
  '{n} Minuten': '{n} minutes',
  '1 Stunde': '1 hour',
  '{n} Stunden': '{n} hours',

  // Countdown-Rückmeldung ("Gespeichert" steht bereits weiter unten)
  'Speichern fehlgeschlagen.': 'Could not save.',
  'Bitte eine Dauer über 0 eingeben.': 'Please enter a duration above 0.',
  'Countdown konnte nicht gestoppt werden.': 'Could not stop the countdown.',

  // Chatter-Liste
  'Twitch liefert diese Liste mit Verzögerung — neue Chatter tauchen oft erst nach ein paar Minuten auf.':
    'Twitch delivers this list with a delay — new chatters often only show up after a few minutes.',

  // Willkommensseite: Datenschutz
  'Deine Daten bleiben bei dir': 'Your data stays with you',
  'SYNSA läuft vollständig auf deinem eigenen Rechner. Es gibt keinen Server des Entwicklers dazwischen: Das Programm spricht direkt mit Twitch und — falls du das Musik-Overlay nutzt — mit der YouTube-Music-App auf diesem PC.':
    'SYNSA runs entirely on your own computer. There is no developer server in between: the app talks directly to Twitch and — if you use the music overlay — to the YouTube Music app on this PC.',
  'Niemand hat Zugriff auf deine Anmeldedaten — auch der Entwickler von SYNSA nicht. Deine Twitch-Zugangsdaten, deine Chat-Inhalte und dein Alert-Verlauf verlassen diesen Rechner nicht.':
    'Nobody has access to your login details — not even the developer of SYNSA. Your Twitch credentials, your chat contents and your alert history never leave this computer.',
  'Beim Verknüpfen gibst du dein Passwort nie in SYNSA ein: Du bestätigst die Verbindung direkt bei Twitch. Der Zugangsschlüssel, den Twitch danach ausstellt, wird verschlüsselt auf dieser Festplatte abgelegt (über Electrons safeStorage) und nur benutzt, um Alerts, Chat und Stream-Infos zu holen. Du kannst die Verbindung jederzeit in den Einstellungen wieder trennen.':
    'You never type your password into SYNSA: you confirm the connection with Twitch directly. The access key Twitch issues afterwards is stored encrypted on this drive (using Electron safeStorage) and is only used to fetch alerts, chat and stream info. You can disconnect again at any time in the settings.',

  // Ziel
  Ziel: 'Goal',
  'Ein Stream-Ziel, das SYNSA aus den eigenen Alerts zählt — unabhängig von Twitchs Creator Goals, deshalb sind auch Bits und Gift-Subs möglich. Die Zählung startet automatisch neu, sobald der Stream live geht.':
    'A stream goal SYNSA counts from its own alerts — independent of Twitch Creator Goals, which is why bits and gift subs are possible too. The count restarts automatically as soon as the stream goes live.',
  'Was wird gezählt': 'What is counted',
  Follower: 'Followers',
  'Neue Subs': 'New subs',
  'Gift-Subs': 'Gift subs',
  // "Bits" steht bereits weiter unten in dieser Tabelle.
  Zielwert: 'Target',
  'Ziel speichern': 'Save goal',
  Zurücksetzen: 'Reset',
  'Aktueller Stand': 'Current progress',
  'Gezählt seit': 'Counted since',
  'Ziel-Overlay': 'Goal overlay',
  'Follower-Ziel': 'Follower goal',

  // Diagnose
  Diagnose: 'Diagnostics',
  'Diese Seite zeigt nur an und ändert nichts. Bei Problemen ist ein Screenshot davon die schnellste Art, den Zustand weiterzugeben.':
    'This page only displays; it changes nothing. If something is wrong, a screenshot of it is the fastest way to pass the state on.',
  'Overlays in OBS': 'Overlays in OBS',
  Musik: 'Music',
  Server: 'Server',
  // "Verbindung", "Kanal", "Music-Overlay", "Installierte Version" und
  // "Fehler" stehen bereits weiter unten in dieser Tabelle.
  'EventSub-Subscriptions': 'EventSub subscriptions',
  OK: 'OK',
  Fehlgeschlagen: 'Failed',
  'Keine Verbindung': 'No connection',
  'Twitch hat den Zugriff abgelehnt — SYNSA muss neu verknüpft werden.':
    'Twitch rejected access — SYNSA has to be linked again.',
  'Alert-Overlay': 'Alert overlay',
  'Countdown-Overlay': 'Countdown overlay',
  'Verbunden ({n})': 'Connected ({n})',
  'Gerade nicht sichtbar': 'Not visible right now',
  'Noch nie verbunden': 'Never connected',
  'Diese Browser Source ist in OBS noch nicht eingerichtet.': 'This browser source is not set up in OBS yet.',
  'Zuletzt gesehen': 'Last seen',
  'Primär (Ton + Warteschlange)': 'Primary (sound + queue)',
  'YTMDesktop gekoppelt': 'YTMDesktop paired',
  Ja: 'Yes',
  Nein: 'No',
  'Gekoppelt, aber keine Verbindung — läuft die YouTube-Music-App?':
    'Paired but not connected — is the YouTube Music app running?',
  Status: 'Status',
  'Verfügbare Version': 'Available version',
  Aktuell: 'Up to date',
  'Suche läuft': 'Checking',
  'Update verfügbar': 'Update available',
  'Wird heruntergeladen': 'Downloading',
  'Bereit zur Installation': 'Ready to install',
  'Wird installiert': 'Installing',
  Port: 'Port',
  Gebunden: 'Bound',
  'Nicht gebunden': 'Not bound',
  Gestartet: 'Started',
  Stand: 'As of',
  'gerade eben': 'just now',
  'vor 1 Sekunde': '1 second ago',
  'vor {n} Sekunden': '{n} seconds ago',
  'vor 1 Minute': '1 minute ago',
  'vor {n} Minuten': '{n} minutes ago',
  'vor 1 Stunde': '1 hour ago',
  'vor {n} Stunden': '{n} hours ago',
  'vor 1 Tag': '1 day ago',
  'vor {n} Tagen': '{n} days ago',

  'Twitch-Verbindung nicht mehr gültig': 'Twitch connection no longer valid',
  'Alerts und Chat kommen nicht mehr an. Bitte verknüpfe SYNSA erneut mit Twitch.':
    'Alerts and chat are no longer coming through. Please link SYNSA with Twitch again.',
  'Neu verknüpfen': 'Link again',
  'Der Update-Check ist fehlgeschlagen.': 'The update check failed.',
  'Das Update konnte nicht heruntergeladen werden.': 'The update could not be downloaded.',
  'Die Installation konnte nicht vorbereitet werden.': 'The installation could not be prepared.',
  'Das Update ist noch nicht bereit.': 'The update is not ready yet.',
  'Die Installation ist in dieser Umgebung nicht verfügbar.': 'Installing is not available in this environment.',
  'Installation nicht möglich.': 'Installation not possible.',

  // --- Welcome screen --------------------------------------------------------
  'Suche nach Updates …': 'Checking for updates…',
  'Einen Moment.': 'One moment.',
  'SYNSA ist aktuell': 'SYNSA is up to date',
  'Keine weiteren Updates verfügbar.': 'No further updates available.',

  // {v}, {n}, {t}, {a}, {b} are filled in by the script after translating, so
  // the number can sit where the English sentence wants it.
  'Update auf Version {v} verfügbar': 'Update to version {v} available',
  'Version {v} wird heruntergeladen': 'Downloading version {v}',
  'Version {v} ist bereit': 'Version {v} is ready',
  'Version {v} · keine weiteren Updates verfügbar.': 'Version {v} · no further updates available.',
  'noch {n} s': '{n} s left',
  'noch {t} min': '{t} min left',
  '{a} von {b}': '{a} of {b}',
  'Du kannst es jetzt oder später installieren.': 'You can install it now or later.',
  'Du kannst währenddessen weitermachen.': 'You can carry on in the meantime.',
  'SYNSA startet nach der Installation automatisch neu.': 'SYNSA restarts automatically after installing.',
  'Während eines laufenden Streams wird nicht installiert.': 'Nothing is installed while a stream is live.',
  'Die Aktualisierung wird abgeschlossen.': 'The update is being completed.',
  'Update nicht möglich': 'Update not possible',
  'Unbekannter Fehler.': 'Unknown error.',
  Weiter: 'Continue',
  Änderungen: 'Changes',
  'Wird geladen …': 'Loading…',
  'Noch keine Änderungen veröffentlicht.': 'No changes published yet.',
  'Die Änderungen konnten gerade nicht geladen werden.': 'The changes could not be loaded right now.',
  installiert: 'installed',

  // --- About -----------------------------------------------------------------
  Version: 'Version',
  'Version wird geladen …': 'Loading version…',
  'Installierte Version': 'Installed version',
  'Version konnte nicht gelesen werden.': 'The version could not be read.',
  'Nach Updates suchen': 'Check for updates',
  'SYNSA ist aktuell.': 'SYNSA is up to date.',
  'Update-Check fehlgeschlagen.': 'Update check failed.',

  // --- Settings --------------------------------------------------------------
  Twitch: 'Twitch',
  'Nicht verbunden': 'Not connected',
  'Verbunden als': 'Connected as',
  'Mit Twitch verbinden': 'Connect with Twitch',
  Trennen: 'Disconnect',
  Sprache: 'Language',
  'Sprache der Oberfläche': 'Interface language',
  Deutsch: 'German',
  English: 'English',
  'Deutsch ist die Originalsprache von SYNSA. Neue Funktionen erscheinen zuerst auf Deutsch; einzelne Stellen können daher in der englischen Fassung noch deutsch sein.':
    'German is SYNSA’s original language. New features appear in German first, so parts of the English version may still be German.',
  // Text wrapped around inline links reaches the translator as the fragments
  // between those links, so the keys are those fragments — punctuation and
  // leading comma included.
  'Einstellungen einzelner Module liegen beim jeweiligen Modul: Farbe und Cover beim':
    'Settings for individual modules live with that module: colour and cover art with the',
  ', Dauer, Beschriftung und Schriftgröße beim': ', duration, label and font size with the',
  ', Lautstärke im': ', volume in the',
  '. Version und Änderungsliste stehen unter': '. Version and changelog are under',
  'Control-Panel': 'Control panel',

  // --- Dashboard tour --------------------------------------------------------
  Hilfe: 'Help',
  'Erklärt dir die Bereiche des Dashboards': 'Explains what the parts of the dashboard are for',
  'Dashboard-Rundgang starten': 'Start dashboard tour',
  'Rundgang schließen': 'Close tour',
  Fertig: 'Done',

  'Willkommen zu SYNSA': 'Welcome to SYNSA',
  'Willkommen zu SYNSA, deinem Twitch-Terminal.': 'Welcome to SYNSA, your Twitch terminal.',
  'Dieser kurze Rundgang zeigt dir in drei Schritten, wofür die Bereiche des Dashboards da sind.':
    'This short tour walks you through the three parts of the dashboard and what each is for.',

  'Hier kannst du die Kategorie und den Titel deines Streams festlegen. Änderungen werden direkt auf Twitch übernommen. Dafür muss dein Twitch-Konto mit SYNSA verknüpft sein.':
    'Here you set your stream’s title and category. Changes are applied on Twitch straight away. Your Twitch account has to be linked to SYNSA for that.',

  'Hier laufen die Ereignisse deines Streams auf, das Neueste zuunterst.':
    'This is where your stream’s events arrive, newest at the bottom.',
  'Es gibt vier Typen, jeder mit eigenem Symbol: New Follower, New Subscriber (bei verschenkten Abos Gift Sub), Cheer und Raid. Über die Knöpfe darüber blendest du einzelne Typen aus.':
    'There are four types, each with its own icon: New Follower, New Subscriber (Gift Sub for gifted ones), Cheer and Raid. The buttons above let you hide individual types.',
  'Jede Zeile zeigt zusätzlich, ob ein Alert noch wartet, gerade abgespielt wird oder schon durch ist.':
    'Each row also shows whether an alert is still waiting, currently playing, or already done.',

  'Hier kannst du den Twitch-Chat direkt über SYNSA verfolgen und moderieren.':
    'Here you can follow and moderate your Twitch chat directly from SYNSA.',
  'Über die drei Punkte neben einer Nachricht öffnest du die Moderationsaktionen.':
    'The three dots next to a message open the moderation actions.',
  'Ein Timeout sperrt einen Nutzer vorübergehend vom Chat.':
    'A timeout blocks a user from chat temporarily.',
  'Ein Ban sperrt einen Nutzer dauerhaft aus deinem Chat, bis du ihn wieder entbannst.':
    'A ban blocks a user from your chat permanently, until you unban them.',

  // --- Setup -----------------------------------------------------------------
  Einrichtung: 'Setup',
  'SYNSA arbeitet direkt mit deinem Twitch-Kanal. Dafür verbindest du einmalig dein Twitch-Konto — die Bestätigung passiert bei Twitch selbst, in deinem normalen Browser.':
    'SYNSA works directly with your Twitch channel. You link your Twitch account once — the confirmation happens on Twitch itself, in your normal browser.',
  'Diese Rechte braucht SYNSA': 'These are the permissions SYNSA needs',
  'Twitch fragt dich gleich nach diesen Berechtigungen. Hier steht, wofür SYNSA jede einzelne tatsächlich benutzt.':
    'Twitch is about to ask you for these permissions. Here is what SYNSA actually uses each one for.',
  'Alerts auslösen': 'Triggering alerts',
  'Neue Follower, Abos, verschenkte Abos und Bits erkennen — das ist die Grundlage für jede Alert-Einblendung in OBS.':
    'Detecting new followers, subscriptions, gifted subscriptions and bits — the basis for every alert shown in OBS.',
  'Chat lesen und schreiben': 'Reading and writing chat',
  'Deinen Chat im Dashboard anzeigen, Nachrichten aus SYNSA senden und deine Emotes im Emote-Feld verfügbar machen.':
    'Showing your chat in the dashboard, sending messages from SYNSA and making your emotes available in the emote picker.',
  Moderation: 'Moderation',
  'Timeouts und Bans direkt aus dem Dashboard, sowie die Zuschauerliste mit Moderatoren und VIPs.':
    'Timeouts and bans straight from the dashboard, plus the viewer list with moderators and VIPs.',
  'Titel und Kategorie': 'Title and category',
  'Streamtitel und Kategorie ändern, ohne dafür Twitch im Browser öffnen zu müssen.':
    'Changing the stream title and category without having to open Twitch in a browser.',
  'Alles bleibt auf diesem PC: SYNSA speichert die Zugangsdaten verschlüsselt lokal und sendet sie an niemanden außer an Twitch selbst. Du kannst die Verbindung jederzeit im Control-Panel wieder trennen.':
    'Everything stays on this PC: SYNSA stores the credentials encrypted locally and sends them to nobody but Twitch itself. You can disconnect at any time in the settings.',
  'Twitch-Konto verbinden': 'Link Twitch account',
  'Noch nicht verbunden': 'Not linked yet',
  'Ein Klick, dann bestätigst du bei Twitch.': 'One click, then you confirm on Twitch.',
  'Twitch-Seite öffnen (geht in deinem normalen Browser auf).': 'Open the Twitch page (opens in your normal browser).',
  'Diesen Code dort eintragen und bestätigen.': 'Enter this code there and confirm.',
  'Twitch-Seite öffnen': 'Open Twitch page',
  Abbrechen: 'Cancel',
  'SYNSA wartet auf deine Bestätigung …': 'SYNSA is waiting for your confirmation…',
  'Warte auf deine Bestätigung': 'Waiting for your confirmation',
  'Der Code gilt nur für kurze Zeit.': 'The code is only valid for a short while.',
  'Twitch-Konto verbunden': 'Twitch account linked',
  'SYNSA kann jetzt Alerts, Chat und Streaminfos verwenden.': 'SYNSA can now use alerts, chat and stream info.',
  'Weiter zum Dashboard': 'Continue to the dashboard',
  'Wird vorbereitet …': 'Preparing…',
  'Twitch ist gerade nicht erreichbar.': 'Twitch cannot be reached right now.',
  'Verbindung nicht möglich': 'Connection not possible',
  'Die Verbindung ist fehlgeschlagen.': 'The connection failed.',
  'Dieser SYNSA-Version fehlt die Twitch-Client-ID.': 'This build of SYNSA is missing the Twitch client ID.',
  'Bitte eine vollständige SYNSA-Version installieren.': 'Please install a complete build of SYNSA.',
  'Die Verbindung wurde bei Twitch abgelehnt.': 'The connection was declined on Twitch.',
  'Der Code ist abgelaufen. Bitte erneut versuchen.': 'The code has expired. Please try again.',
  'SYNSA hat keine Twitch-Client-ID hinterlegt.': 'SYNSA has no Twitch client ID configured.',

  // --- Control panel ---------------------------------------------------------
  'Master Volume': 'Master volume',
  Follow: 'Follow',
  Subscription: 'Subscription',
  Cheer: 'Cheer',
  Raid: 'Raid',
  Username: 'Username',
  'Gifter Username': 'Gifter username',
  'Gift Sub': 'Gift sub',
  Tier: 'Tier',
  Prime: 'Prime',
  'Monate (Resub)': 'Months (resub)',
  'Anzahl Gifts': 'Number of gifts',
  'Nachricht (optional, max. 500 Zeichen)': 'Message (optional, max. 500 characters)',
  'Nachricht (optional)': 'Message (optional)',
  Bits: 'Bits',
  Kanal: 'Channel',
  Zuschauer: 'Viewers',
  'Follow-Alert senden': 'Send follow alert',
  'Subscription-Alert senden': 'Send subscription alert',
  'Cheer-Alert senden': 'Send cheer alert',
  'Raid-Alert senden': 'Send raid alert',
  'Sound testen': 'Test sound',
  'zufällig, wenn leer': 'random if left empty',
  'z.B. Danke für 8 tolle Monate!': 'e.g. Thanks for 8 great months!',
  'z.B. Nice stream!': 'e.g. Nice stream!',
  'Overlay als OBS Browser Source:': 'Overlay as an OBS browser source:',
  '· Größe/Transparenz wird automatisch erkannt.': '· Size and transparency are detected automatically.',

  // --- Dashboard -------------------------------------------------------------
  'Alert Box': 'Alert box',
  Chat: 'Chat',
  'Stream-Info': 'Stream info',
  Titel: 'Title',
  Kategorie: 'Category',
  Speichern: 'Save',
  'Speichern…': 'Saving…',
  Gespeichert: 'Saved',
  Senden: 'Send',
  Alle: 'All',
  Sub: 'Sub',
  Offline: 'Offline',
  'Stream-Titel': 'Stream title',
  'Kategorie suchen…': 'Search category…',
  'Nachricht an den Chat…': 'Message to chat…',
  'Emote suchen…': 'Search emote…',
  Emotes: 'Emotes',
  'Wer ist im Chat?': "Who's in chat?",
  'Suchen…': 'Search…',
  'Keine Treffer.': 'No matches.',
  'Lade…': 'Loading…',
  'Konnte Chatter nicht laden.': 'Could not load chatters.',
  Broadcaster: 'Broadcaster',
  Moderatoren: 'Moderators',
  VIPs: 'VIPs',
  Abonnenten: 'Subscribers',
  'Konnte Emotes nicht laden.': 'Could not load emotes.',
  '{n} von {total} Twitch-Abonnements konnten nicht eingerichtet werden.':
    '{n} of {total} Twitch subscriptions could not be set up.',
  'Diese Ereignisse kommen nicht an:': 'These events will not arrive:',
  Fehler: 'Error',
  'Fehler: {msg}': 'Error: {msg}',
  'Ungültige Dauer': 'Invalid duration',

  // --- Music overlay ---------------------------------------------------------
  Verbindung: 'Connection',
  'YouTube Music Desktop App': 'YouTube Music Desktop App',
  Verbinden: 'Connect',
  'Jetzt läuft': 'Now playing',
  Anzeige: 'Display',
  'Overlay-URL': 'Overlay URL',
  Verbunden: 'Connected',
  'Bitte in YTMDesktop die Verbindungsanfrage bestätigen (bis zu 30 Sekunden)…':
    'Please confirm the connection request in YTMDesktop (up to 30 seconds)…',
  'Verbunden!': 'Connected!',
  'Pairing fehlgeschlagen': 'Pairing failed',

  // --- Countdown -------------------------------------------------------------
  '"Starting Soon"-Countdown für OBS. Dauer eingeben und starten — die Overlay-Quelle zählt live mit, egal wann sie geladen wird.':
    '"Starting Soon" countdown for OBS. Enter a duration and start it — the overlay source counts along live, no matter when it is loaded.',
  'Schriftgröße': 'Font size',
  // Fehlten bisher — dieselben Beschriftungen stehen auf der Countdown- und
  // der Ziel-Seite, beide blieben deutsch.
  Anzeigetext: 'Display text',
  Akzentfarbe: 'Accent colour',
  'Läuft noch: {t}': '{t} remaining',
  'Min.': 'min',
  'Sek.': 'sec',
  'Starting Soon': 'Starting Soon',
  Starten: 'Start',
  Stoppen: 'Stop',
  Vorschau: 'Preview',
  Klein: 'Small',
  Mittel: 'Medium',
  'Groß': 'Large',
  '5 Min': '5 min',
  '10 Min': '10 min',
  '15 Min': '15 min',
  '30 Min': '30 min',
  'Bei 0:00 angekommen': 'Reached 0:00',

  // --- Shared small bits -----------------------------------------------------
  Anzeigen: 'Show',
  Kopieren: 'Copy',
  Kopiert: 'Copied',
  Session: 'Session',
};
