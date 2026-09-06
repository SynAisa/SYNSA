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
const os = require('os');
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
// baked into that file at build time. The repository itself comes from
// update/repository.js, shared with the changelog in server.js.
const { owner, repo } = require('./repository');

autoUpdater.setFeedURL({ provider: 'github', owner, repo });

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

// Release bodies are turned into plain text lines by update/releaseNotes.js,
// shared with the changelog the welcome screen shows so both render the exact
// same release the exact same way.
const { toLines: extractNotes } = require('./releaseNotes');

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

// ---------------------------------------------------------------------------
// Differential downloads: keeping the two halves of the updater cache in sync
// ---------------------------------------------------------------------------
//
// electron-updater can download only the changed blocks of a new installer
// instead of the whole ~107 MB file. To do that it needs two things that live
// side by side in %LOCALAPPDATA%\synsa-updater\:
//
//   installer.exe      — written by the NSIS installer while it installs
//                        (app-builder-lib templates/nsis/include/installer.nsh:
//                        copyFile "$EXEPATH" "$LOCALAPPDATA\...\installer.exe")
//   current.blockmap   — written by electron-updater right after it *downloads*
//                        an installer (AppUpdater.js executeDownload(): the
//                        pending copy is moved up into the cache root in done())
//
// It then reads the old block map from the cache if one is there, and only
// falls back to downloading it from the release URL when it is not
// (AppUpdater.js differentialDownloadInstaller: getBlockMapFromCacheDir() ??
// downloadBlockMap()). Nothing verifies that the two files describe the same
// version — the library simply assumes that whatever was downloaded last is
// also what is installed.
//
// SYNSA breaks that assumption on purpose: autoDownload is off, and
// downloading and installing are two separate user decisions. Download 0.1.10
// and never install it, and the cache holds 0.1.10's block map next to 0.1.9's
// installer.exe. The next update then copies blocks from offsets that are only
// valid for 0.1.10 out of a file that is still 0.1.9 — the assembled installer
// is garbage, the final sha512 check catches it, and electron-updater falls
// back to the full download. That is exactly the failure recorded in
// synsa.log for 0.1.3 -> 0.1.4 ("sha512 checksum mismatch ... fallback to
// full download").
//
// electron-updater offers no option to keep the two in sync
// (disableDifferentialDownload only turns the feature off entirely, and
// previousBlockmapBaseUrlOverride only changes *where* the old block map is
// fetched from, not whether the stale cached one is preferred). So we remove
// the cached block map before every download. electron-updater then takes its
// own documented fallback and fetches the block map belonging to the version
// this app actually is — which is by construction the same version
// installer.exe came from, because the installer of that version wrote it.
//
// Cost: one extra ~120 KB request per update. In exchange the copy source and
// the block map can no longer disagree, so a small update really does transfer
// only its changed blocks.
function resolveBaseCachePath() {
  // Mirrors electron-updater's AppAdapter.getAppCacheDir().
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches');
  }
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

async function resolveUpdaterCacheDir() {
  // electron-updater already knows this path, so ask it rather than keeping a
  // second copy of the derivation that could drift. The method is internal, so
  // if it ever disappears we compute the same thing it computes:
  // path.join(getAppCacheDir(), updaterCacheDirName ?? app.getName()).
  try {
    if (typeof autoUpdater.getOrCreateDownloadHelper === 'function') {
      const helper = await autoUpdater.getOrCreateDownloadHelper();
      if (helper && typeof helper.cacheDir === 'string' && helper.cacheDir) {
        return helper.cacheDir;
      }
    }
  } catch {
    // Fall through to the local derivation below.
  }

  let cacheDirName = null;
  try {
    const config = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const match = /^updaterCacheDirName:\s*(\S+)\s*$/m.exec(config);
    if (match) cacheDirName = match[1];
  } catch {
    // No readable app-update.yml — app.getName() is what electron-updater
    // itself falls back to in that case.
  }

  return path.join(resolveBaseCachePath(), cacheDirName || app.getName());
}

async function discardCachedBlockMap() {
  try {
    const blockMapFile = path.join(await resolveUpdaterCacheDir(), 'current.blockmap');
    if (fs.existsSync(blockMapFile)) {
      fs.rmSync(blockMapFile);
      writeUpdaterLog('info', `Removed cached ${blockMapFile} so the old block map is fetched for the installed version.`);
    }
  } catch (err) {
    // Never a reason to fail an update: without the removal the worst case is
    // the behaviour we already had — a differential attempt that may fall back
    // to a full download.
    writeUpdaterLog('warn', `Could not remove cached block map: ${err.message}`);
  }
}

// onProgress({ downloadedBytes, totalBytes, percent }) — same shape
// UpdateManager already expects from localTestProvider.download().
async function download(release, onProgress) {
  await discardCachedBlockMap();

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
