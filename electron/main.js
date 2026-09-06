const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, dialog, shell, clipboard, Notification, nativeImage } = require('electron');

const PORT = process.env.PORT || 4242;
const BASE_URL = `http://localhost:${PORT}`;

// Only one copy of the server should ever be running at once.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Renaming the app to SYNSA moves Electron's userData folder, and that is
// not just where files live: Chromium keeps the key that safeStorage
// encrypts with in "Local State" *inside* that folder. A new folder means a
// newly generated key, so every previously encrypted file — Twitch tokens,
// client credentials, the YTMDesktop pairing — becomes undecryptable even
// though the files themselves are untouched. Carrying the old key across is
// what actually makes the rename non-destructive; copying data/ alone is
// not enough. Runs before anything can touch safeStorage.
function migrateFromLegacyName() {
  const userDataDir = app.getPath('userData');
  const marker = path.join(userDataDir, '.synsa-migrated');
  if (fs.existsSync(marker)) return;

  // Electron derived these from package.json: "Stream Alerts" for the
  // packaged build (productName), "stream-alerts" for `npm run electron`.
  const legacyName = app.isPackaged ? 'Stream Alerts' : 'stream-alerts';
  const legacyDir = path.join(path.dirname(userDataDir), legacyName);
  if (!fs.existsSync(legacyDir)) return;

  try {
    fs.mkdirSync(userDataDir, { recursive: true });

    const legacyKey = path.join(legacyDir, 'Local State');
    if (fs.existsSync(legacyKey)) {
      fs.copyFileSync(legacyKey, path.join(userDataDir, 'Local State'));
      console.log('Migrated encryption key from the previous app folder.');
    }

    // Only the packaged build keeps its data inside userData; the dev flow
    // reads <project>/data, which the rename never moved.
    if (app.isPackaged) {
      const legacyData = path.join(legacyDir, 'data');
      const newData = path.join(userDataDir, 'data');
      if (fs.existsSync(legacyData) && !fs.existsSync(newData)) {
        fs.cpSync(legacyData, newData, { recursive: true });
        console.log('Migrated existing data folder.');
      }
    }

    fs.writeFileSync(marker, new Date().toISOString());
  } catch (err) {
    console.error('Migration from the previous app folder failed:', err.message);
  }
}

// Packaged .exe: keep runtime data (credentials, Twitch tokens, event
// history) in the user's own writable profile folder rather than next to
// a possibly read-only install location. Must be set before requiring
// server.js. A .env next to the .exe still works as an optional override
// for anyone who prefers it, but is no longer required — the app asks for
// the Twitch credentials on first run instead.
migrateFromLegacyName();

if (app.isPackaged) {
  process.env.SYNSA_DATA_DIR = path.join(app.getPath('userData'), 'data');

  // The portable build self-extracts and runs from a temp folder, so
  // app.getPath('exe') points there, not to the real .exe; electron-builder
  // sets PORTABLE_EXECUTABLE_DIR to the actual location instead.
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  require('dotenv').config({ path: path.join(exeDir, '.env') });

  setupFileLogging();
} else {
  // Dev only: watching the packaged .exe would be pointless (it's a
  // frozen snapshot), but during `npm run electron` this restarts the
  // whole app automatically whenever server.js, twitch/, electron/, or
  // public/ change — no more manually killing and relaunching after
  // every edit. data/ and dist/ are deliberately not watched: they
  // change on their own (event history, chat log, build output) and
  // would otherwise restart the app in a loop.
  try {
    require('electron-reload')(
      [
        path.join(__dirname, '..', 'server.js'),
        path.join(__dirname, '..', 'twitch'),
        path.join(__dirname, '..', 'music'),
        path.join(__dirname, '..', 'public'),
        __dirname,
      ],
      {
        electron: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
        hardResetMethod: 'exit',
        // Without this, electron-reload only soft-reloads open windows on
        // a change and reserves the actual process restart for edits to
        // this file alone — useless for a project that's mostly backend.
        forceHardReset: true,
      }
    );
  } catch (err) {
    console.warn('electron-reload not active:', err.message);
  }
}

let mainWindow = null;
let isQuitting = false;

// What the window's X button does. Stored as a small JSON file in the data
// directory, the same way countdown.json and music-settings.json are — the
// settings page reads and writes it through the server (see
// /api/close-behavior), and this process reads it fresh on every close so a
// change made in that page takes effect without a restart.
//
//   'ask'  — show the dialog (default)
//   'tray' — hide to the tray, the behaviour this always had
//   'quit' — really quit
const CLOSE_BEHAVIORS = new Set(['ask', 'tray', 'quit']);
const { getDataDir } = require(path.join(__dirname, '..', 'twitch', 'dataDir.js'));
const WINDOW_SETTINGS_FILE = path.join(getDataDir(), 'window-settings.json');

function readCloseBehavior() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_SETTINGS_FILE, 'utf8'));
    return CLOSE_BEHAVIORS.has(saved.closeBehavior) ? saved.closeBehavior : 'ask';
  } catch {
    return 'ask';
  }
}

function writeCloseBehavior(value) {
  try {
    fs.mkdirSync(path.dirname(WINDOW_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(WINDOW_SETTINGS_FILE, JSON.stringify({ closeBehavior: value }));
  } catch (err) {
    console.error('Could not save window close behavior:', err.message);
  }
}

// Clicking X twice before answering would otherwise stack dialogs.
let closePromptOpen = false;

const update = require(path.join(__dirname, '..', 'update', 'manager.js'));

// The provider decision itself lives in update/manager.js (packaged app ->
// real GitHub releases, dev run -> local test provider, SYNSA_UPDATE_PROVIDER
// overrides both) and is read back from there rather than re-derived here:
// the two used to evaluate the same environment variable separately, which
// only had to drift once to register an install handler that didn't match
// the provider actually loaded. Knowing *which* provider is active is not the
// same as knowing about electron-updater — that stays confined to this file
// and update/productionProvider.js, and no renderer page learns either.
const USE_PRODUCTION_UPDATE_PROVIDER = update.USE_PRODUCTION_PROVIDER;

if (USE_PRODUCTION_UPDATE_PROVIDER) {
  // A real downloaded update needs electron-updater's own quit-and-run-the-
  // installer sequence, not a bare restart of the still-current binary.
  const productionProvider = require(path.join(__dirname, '..', 'update', 'productionProvider.js'));
  update.setInstallHandler(() => productionProvider.quitAndInstall());
} else {
  // Phase 2A: no real second build exists to install yet (see the local
  // test provider), so "installing" here means honestly restarting the
  // current installation rather than faking a version change.
  update.setInstallHandler(() => {
    app.relaunch();
    app.exit(0);
  });
}

// Runs once per app start. No native dialog and no window management here
// on purpose: an earlier version showed a dialog.showMessageBoxSync popup
// and/or forced a navigation to dashboard.html, both of which interrupted
// whatever the user was doing (setup.html included) for UX no one asked
// for. The check just updates UpdateManager's state; whichever page the
// user already has open (setup.html, dashboard.html, settings.html — see
// public/shared/update-banner.js, present on all three) picks the result
// up on its own over its own WebSocket connection. Manual, on-demand
// checks go through the exact same update.checkForUpdates() call (see
// server.js's "Nach Updates suchen" endpoint) — no separate logic.
async function checkForUpdatesOnStartup() {
  try {
    await update.checkForUpdates({ manual: false });
  } catch (err) {
    console.error('Startup update check failed:', err.message);
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const server = require(path.join(__dirname, '..', 'server.js'));

  try {
    await server.ready;
  } catch (err) {
    const message =
      err.code === 'EADDRINUSE'
        ? `Port ${PORT} ist bereits belegt. Läuft SYNSA vielleicht schon (Tray-Icon prüfen) oder blockiert ein anderes Programm den Port?`
        : `Der lokale Server konnte nicht gestartet werden:\n\n${err.message}`;
    dialog.showErrorBox('SYNSA', message);
    app.exit(1);
    return;
  }

  createTray();

  // A version the user hasn't been greeted by yet — a fresh installation, or
  // the first start after an update — opens the welcome screen, which shows
  // the version and what changed and then hands over to the setup or the
  // dashboard itself. Otherwise the old rule still applies in its new form:
  // with no Twitch account linked, go straight to setup rather than a
  // dashboard that cannot work; once linked, start quietly in the tray as
  // before. ("Linked" replaced "credentials entered" when SYNSA moved to the
  // device code flow — see twitch/deviceAuth.js.)
  const tokenStore = require(path.join(__dirname, '..', 'twitch', 'tokenStore.js'));
  const welcomeState = require(path.join(__dirname, '..', 'update', 'welcomeState.js'));

  if (welcomeState.shouldWelcome(app.getVersion())) {
    openAppWindow('welcome.html');
  } else if (!tokenStore.load()) {
    openAppWindow('setup.html');
  }

  checkForUpdatesOnStartup();
});

// Double-clicking the .exe again shouldn't look like nothing happened.
app.on('second-instance', () => {
  openAppWindow('dashboard.html');
});

app.on('window-all-closed', (e) => {
  // The window hides instead of closing (see openAppWindow) — this is a
  // fallback and should rarely fire. Either way, stay alive in the tray.
  e.preventDefault();
});

app.on('before-quit', () => {
  isQuitting = true;
});

function setupFileLogging() {
  const logPath = path.join(app.getPath('userData'), 'synsa.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const stream = fs.createWriteStream(logPath, { flags: 'a' });

  for (const method of ['log', 'error', 'warn']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      // Each half is isolated: a packaged SYNSA is usually started without
      // any console attached (a shortcut, the tray, or — after an update —
      // the installer itself relaunching it), and a stdout write that throws
      // in that situation must not be able to take the log file with it.
      // This file is the only record of what happened during an unattended
      // update, so it is the half that has to survive.
      try {
        original(...args);
      } catch {
        // No usable stdout — the file below is what matters.
      }
      try {
        stream.write(`[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`);
      } catch {
        // Never let logging itself break the app.
      }
    };
  }
}

// Dashboard and Control Panel already link to each other with plain
// <a href> tags, so a single reused window just navigates between them —
// no need for two separate windows.
function openAppWindow(pagePath) {
  const url = `${BASE_URL}/${pagePath}`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url);
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#0b0d0d',
    autoHideMenuBar: true,
    title: `SYNSA v${app.getVersion()}`,
    // Without this the taskbar/Alt-Tab icon falls back to Electron's own
    // logo — same teal-circle icon the tray already uses.
    icon: path.join(__dirname, 'assets', 'tray-icon.png'),
    webPreferences: {
      // The pages are plain web pages talking to localhost over HTTP —
      // they never need Node, so don't hand it to them.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(url);

  // Each page sets its own <title> (e.g. "SYNSA · Dashboard"), which would
  // otherwise silently drop the version the instant that page finishes
  // loading. Appending it here instead of setting it once keeps it visible
  // no matter which page is open.
  mainWindow.on('page-title-updated', (event, title) => {
    event.preventDefault();
    mainWindow.setTitle(`${title} — v${app.getVersion()}`);
  });

  // Twitch (like most OAuth providers) refuses to log in inside an
  // embedded/app browser window — it needs to happen in the user's real
  // browser. The callback still lands back on our own localhost server
  // either way, so the app window picks up the "connected" state live
  // over the WebSocket without needing to navigate anywhere itself.
  const sendExternal = (event, targetUrl) => {
    if (!targetUrl.startsWith(BASE_URL)) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  };

  mainWindow.webContents.on('will-navigate', sendExternal);

  // Clicking "Mit Twitch verbinden" navigates to our own /auth/twitch/login
  // first (allowed above), which then answers with an HTTP redirect to
  // Twitch — that's a *redirect*, not a fresh navigation, so it needs its
  // own handler.
  mainWindow.webContents.on('will-redirect', sendExternal);

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (!targetUrl.startsWith(BASE_URL)) {
      shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });

  // isQuitting is set by the tray's "Beenden" and by app.before-quit, and
  // those keep going straight through here untouched — this dialog is only
  // ever about the window's own X button.
  mainWindow.on('close', (e) => {
    if (isQuitting) return;

    e.preventDefault();

    const behavior = readCloseBehavior();
    if (behavior === 'tray') {
      mainWindow.hide();
      return;
    }
    if (behavior === 'quit') {
      isQuitting = true;
      app.quit();
      return;
    }

    if (closePromptOpen) return;
    closePromptOpen = true;

    // Async rather than showMessageBoxSync: only the async form reports the
    // checkbox back. The close is already prevented above, so the window
    // simply stays open until this resolves.
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        title: 'SYNSA schließen',
        message: 'Soll SYNSA im Hintergrund weiterlaufen?',
        detail:
          'Im Tray läuft SYNSA weiter: Alerts, Chat und die Overlays in OBS bleiben aktiv. Beim Beenden hören sie auf zu funktionieren, bis du SYNSA wieder startest.',
        buttons: ['In den Tray minimieren', 'SYNSA beenden', 'Abbrechen'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: 'Diese Wahl merken',
        checkboxChecked: false,
        noLink: true,
      })
      .then(({ response, checkboxChecked }) => {
        closePromptOpen = false;

        // Cancel leaves everything as it is — no hiding, no quitting.
        if (response === 2) return;

        const chosen = response === 1 ? 'quit' : 'tray';
        if (checkboxChecked) writeCloseBehavior(chosen);

        if (chosen === 'quit') {
          isQuitting = true;
          app.quit();
        } else {
          mainWindow.hide();
        }
      })
      .catch((err) => {
        closePromptOpen = false;
        // Never leave the user unable to close the window because a dialog
        // failed — fall back to the behaviour this always had.
        console.error('Close dialog failed:', err.message);
        mainWindow.hide();
      });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  const tray = new Tray(icon);
  tray.setToolTip(`SYNSA v${app.getVersion()}`);

  const menu = Menu.buildFromTemplate([
    { label: 'Dashboard öffnen', click: () => openAppWindow('dashboard.html') },
    { label: 'Control-Panel öffnen', click: () => openAppWindow('control.html') },
    { label: 'Music-Overlay-Einstellungen öffnen', click: () => openAppWindow('music-settings.html') },
    { label: 'Countdown-Einstellungen öffnen', click: () => openAppWindow('countdown-settings.html') },
    { label: 'Ziel-Einstellungen öffnen', click: () => openAppWindow('goal-settings.html') },
    { type: 'separator' },
    {
      label: 'Overlay-URL kopieren',
      click: () => {
        clipboard.writeText(`${BASE_URL}/overlay.html`);
        notify('Overlay-URL kopiert', `${BASE_URL}/overlay.html`);
      },
    },
    {
      label: 'Music-Overlay-URL kopieren',
      click: () => {
        clipboard.writeText(`${BASE_URL}/overlay-music.html`);
        notify('Music-Overlay-URL kopiert', `${BASE_URL}/overlay-music.html`);
      },
    },
    {
      label: 'Countdown-Overlay-URL kopieren',
      click: () => {
        clipboard.writeText(`${BASE_URL}/overlay-countdown.html`);
        notify('Countdown-Overlay-URL kopiert', `${BASE_URL}/overlay-countdown.html`);
      },
    },
    {
      label: 'Ziel-Overlay-URL kopieren',
      click: () => {
        clipboard.writeText(`${BASE_URL}/overlay-goal.html`);
        notify('Ziel-Overlay-URL kopiert', `${BASE_URL}/overlay-goal.html`);
      },
    },
    { label: 'Twitch-Zugangsdaten ändern', click: () => openAppWindow('setup.html') },
    { label: 'Diagnose öffnen', click: () => openAppWindow('diagnostics.html') },
    ...(app.isPackaged
      ? [
          {
            label: 'Log-Datei öffnen',
            click: () => shell.openPath(path.join(app.getPath('userData'), 'synsa.log')),
          },
        ]
      : []),
    { type: 'separator' },
    { label: 'Beenden', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => openAppWindow('dashboard.html'));
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}
