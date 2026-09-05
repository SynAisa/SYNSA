// ============================================================================
// PHASE 2B — PRODUCTION PROVIDER. Real updates via public GitHub Releases.
// ============================================================================
//
// Wraps electron-updater completely. Fulfils the exact same provider
// contract as update/localTestProvider.js:
//   checkForUpdate() -> Promise<{ version, type, notes, sizeBytes } | null>
//   download(release, onProgress) -> Promise<void>
//
// update/manager.js (UpdateManager) is the only thing that decides what any
// of that means for SYNSA's state — this file never touches UpdateManager's
// state, never opens a dialog or banner, never looks at Twitch or the
// stream-live state, and never manipulates a BrowserWindow. It also invents
// no version-comparison logic of its own (see versionCompare.js, used
// exclusively by manager.js): it only ever reports exactly what
// electron-updater's own check said, or null.
//
// Requires a real Electron process (electron-updater's autoUpdater needs
// app.getVersion()/app.getPath() etc. internally) — this module is only
// ever loaded when SYNSA_UPDATE_PROVIDER=production, which only makes sense
// running under the real packaged app, never under plain `node server.js`.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

// electron-updater's own messages are the only record of what happens during
// the install step — which ends with the app exiting immediately afterwards.
// The async log stream in electron/main.js never gets to flush those last
// lines, so exactly the messages that would explain an install which appeared
// to do nothing ("run installer using elevate.exe", "Executing: ...",
// "Cannot run installer: error code: ...") were the ones reproducibly lost.
// These events are few and rare, so they are written straight to disk
// synchronously, into the same file main.js logs to; normal app logging keeps
// its async stream and stays unaffected.
const UPDATER_LOG_PATH = path.join(app.getPath('userData'), 'synsa.log');

function writeUpdaterLog(level, ...args) {
  try {
    fs.appendFileSync(UPDATER_LOG_PATH, `[${new Date().toISOString()}] [updater/${level}] ${args.map(String).join(' ')}\n`);
  } catch {
    // Logging must never be the reason an update fails.
  }
}

autoUpdater.logger = {
  info: (...args) => writeUpdaterLog('info', ...args),
  warn: (...args) => writeUpdaterLog('warn', ...args),
  error: (...args) => writeUpdaterLog('error', ...args),
  debug: (...args) => writeUpdaterLog('debug', ...args),
};

// Explicit, not inferred from the git remote (electron-builder does that
// automatically for app-update.yml when a `publish` block exists in
// package.json — see the Phase 2B preflight audit) — set here too so the
// running app's behavior never silently depends on what happened to be
// baked into that file at build time.
autoUpdater.setFeedURL({ provider: 'github', owner: 'SynAisa', repo: 'SYNSA' });

// The whole point of Phase 2A's UX (explicit user confirmation before any
// download, stream-lock before any install) depends on electron-updater
// never acting on its own. These two flags are what make that true.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// electron-updater doesn't always emit one of update-available/
// update-not-available/error — e.g. in an unpacked dev build it silently
// no-ops ("Skip checkForUpdates because application is not packed"),
// confirmed live while testing this file, and other conditions could
// plausibly hit the same silent gap. Without a bound, checkForUpdate()'s
// promise would then simply never resolve, leaving UpdateManager stuck in
// its "checking" phase forever with no way to retry. This timeout makes
// that fail safely into the existing error/retry UX instead.
const CHECK_TIMEOUT_MS = 30000;

// checkForUpdate() and download() below only run one at a time in
// practice (UpdateManager serializes them via its own phase checks), but
// electron-updater's API is event-based rather than call-scoped — this is
// where the most recently reported release the app has, so a later
// quitAndInstall() call knows what's actually been downloaded.
let lastUpdateInfo = null;

// electron-updater's releaseNotes can be a plain string, or (when several
// versions are skipped at once) an array of { version, note } entries.
// Either way this only ever produces plain lines of text for the existing
// banner UI to render — no markdown rendering, no HTML interpretation.
function extractNotes(releaseNotes) {
  if (!releaseNotes) return [];

  const raw = Array.isArray(releaseNotes) ? releaseNotes.map((entry) => entry.note || '').join('\n') : String(releaseNotes);

  return raw
    .replace(/<[^>]+>/g, '') // strip any embedded HTML from the GitHub release body
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

// No native concept of "critical" exists in a GitHub Release — this is a
// simple, explicit convention (not a real version-comparison decision,
// which stays entirely in versionCompare.js/manager.js): a release whose
// notes start with "[critical]" is surfaced as critical. Anything else is
// "normal". This is a Phase 2B-1 placeholder convention, not a finished
// feature — see the final report.
function detectType(releaseNotesRaw) {
  const text = Array.isArray(releaseNotesRaw)
    ? releaseNotesRaw.map((entry) => entry.note || '').join('\n')
    : String(releaseNotesRaw || '');
  return /^\s*\[critical\]/i.test(text) ? 'critical' : 'normal';
}

function mapUpdateInfo(info) {
  const file = Array.isArray(info.files) && info.files.length > 0 ? info.files[0] : null;
  return {
    version: info.version,
    type: detectType(info.releaseNotes),
    notes: extractNotes(info.releaseNotes),
    sizeBytes: file && typeof file.size === 'number' ? file.size : null,
  };
}

function checkForUpdate() {
  return new Promise((resolve, reject) => {
    const onAvailable = (info) => {
      cleanup();
      lastUpdateInfo = info;
      resolve(mapUpdateInfo(info));
    };
    const onNotAvailable = () => {
      cleanup();
      lastUpdateInfo = null;
      resolve(null);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Update check timed out with no response from electron-updater'));
    }, CHECK_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      autoUpdater.off('update-available', onAvailable);
      autoUpdater.off('update-not-available', onNotAvailable);
      autoUpdater.off('error', onError);
    }

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);

    autoUpdater.checkForUpdates().catch(onError);
  });
}

// onProgress({ downloadedBytes, totalBytes, percent }) — same shape
// UpdateManager already expects from localTestProvider.download().
function download(release, onProgress) {
  return new Promise((resolve, reject) => {
    const onProgressEvent = (progress) => {
      onProgress({
        downloadedBytes: progress.transferred,
        totalBytes: progress.total,
        percent: Math.round(progress.percent),
      });
    };
    const onDownloaded = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    function cleanup() {
      autoUpdater.off('download-progress', onProgressEvent);
      autoUpdater.off('update-downloaded', onDownloaded);
      autoUpdater.off('error', onError);
    }

    autoUpdater.on('download-progress', onProgressEvent);
    autoUpdater.once('update-downloaded', onDownloaded);
    autoUpdater.once('error', onError);

    autoUpdater.downloadUpdate().catch(onError);
  });
}

// Provider-specific install hook (see update/manager.js's requestInstall(),
// which calls provider.markInstalled() only if present — the equivalent
// pattern here). electron/main.js is the only caller: it registers this as
// the install handler instead of app.relaunch()+app.exit() when
// SYNSA_UPDATE_PROVIDER=production, since a real downloaded update needs
// electron-updater's own quit-and-run-the-installer sequence, not a bare
// restart of the still-current binary. Never called from a renderer.
function quitAndInstall() {
  if (!lastUpdateInfo) {
    throw new Error('quitAndInstall() called with no downloaded update on record');
  }
  // isSilent=true, isForceRunAfter=true: the downloaded NSIS installer
  // still runs elevated via UAC (isAdminRightsRequired is computed
  // separately, from the downloaded file's own metadata, and is
  // unaffected by isSilent) but without its own visible install wizard,
  // and relaunches SYNSA automatically afterward. Without isSilent here,
  // the user would see a normal NSIS installer UI after confirming UAC,
  // and — in our oneClick:false config specifically — the app would not
  // even auto-restart afterward at all (electron-builder's assisted
  // installer only honors "run after finish" when combined with silent
  // mode; see installSection.nsh).
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { checkForUpdate, download, quitAndInstall, IS_LOCAL_TEST_PROVIDER: false };
