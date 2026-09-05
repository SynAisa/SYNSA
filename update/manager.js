// UpdateManager — owns update checking, current update state, release
// metadata, download state, errors, and installation readiness. Nothing
// outside this file decides whether an update exists or is safe to
// install; the Dashboard/Settings pages only ever render whatever state
// this module publishes and call its actions.
//
// Provider contract (see update/localTestProvider.js for the Phase 2A
// implementation, and the header comment there for why it's local-only):
//   checkForUpdate() -> Promise<{ version, type, notes, sizeBytes } | null>
//   download(release, onProgress) -> Promise<void>
//     onProgress is called with { downloadedBytes, totalBytes, percent }
//
// A future ProductionProvider (Phase 2B, e.g. backed by GitHub Releases)
// only needs to implement that same contract and be swapped in below —
// nothing else in this file, server.js, electron/main.js, or the renderer
// pages needs to change.
const { isNewerVersion } = require('./versionCompare');

// PHASE 2A: local test provider only. See localTestProvider.js — it makes
// no network requests and cannot become a production update source by
// accident; there is simply nothing else wired in yet.
const provider = require('./localTestProvider');

const PHASES = {
  IDLE: 'idle',
  CHECKING: 'checking',
  AVAILABLE: 'available',
  DOWNLOADING: 'downloading',
  READY: 'ready',
  INSTALLING: 'installing',
  ERROR: 'error',
};

// Gives the INSTALLING state time to actually reach a connected page (and a
// human time to read "SYNSA wird neu gestartet") before the real restart —
// see requestInstall() below.
const INSTALL_RESTART_DELAY_MS = 1800;

// Injected by consumers at init time — kept as plain functions/callbacks
// rather than this module reaching for `require('electron')` or Twitch
// state itself, so it stays usable (and testable) under a plain
// `node server.js` run too, and never duplicates the existing Twitch
// live/offline implementation (see server.js's state.stream).
let getCurrentVersion = () => '0.0.0';
let isStreamLive = () => false;
// Set by electron/main.js; stays null under a plain `node server.js` run,
// where there is no real app to restart.
let performInstall = null;

const listeners = new Set();

let state = {
  phase: PHASES.IDLE,
  currentVersion: null,
  release: null, // { version, type, notes, sizeBytes }
  download: null, // { downloadedBytes, totalBytes, percent }
  error: null, // { message, phase }
  installBlocked: false,
  checkedAt: null,
  // "Später": hides the banner for the rest of this running process only —
  // never persisted, so a real app restart (or a fresh manual check, which
  // always re-surfaces the result of that explicit user action) naturally
  // clears it. See dismissForSession() below.
  dismissedForSession: false,
};

function computeInstallBlocked(candidate) {
  return candidate.phase === PHASES.READY && isStreamLive();
}

function setState(patch) {
  state = { ...state, ...patch };
  state = { ...state, installBlocked: computeInstallBlocked(state) };
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      console.error('Update listener failed:', err.message);
    }
  }
}

function init({ getCurrentVersion: getVersionFn, isStreamLive: isLiveFn } = {}) {
  if (typeof getVersionFn === 'function') getCurrentVersion = getVersionFn;
  if (typeof isLiveFn === 'function') isStreamLive = isLiveFn;
  state = { ...state, currentVersion: getCurrentVersion() };
}

// electron/main.js supplies the real implementation (app.relaunch() +
// app.exit()). Never called directly by this module under plain Node.
function setInstallHandler(fn) {
  performInstall = fn;
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getState() {
  return state;
}

// Called by server.js whenever the *existing* Twitch live/offline state
// changes (state.stream), so a ready-and-waiting update immediately
// reflects a stream that just started or ended, without this module
// polling or keeping its own copy of that state.
function notifyStreamChanged() {
  if (state.phase === PHASES.READY) {
    setState({});
  }
}

async function checkForUpdates({ manual = false } = {}) {
  if (state.phase === PHASES.CHECKING || state.phase === PHASES.DOWNLOADING) {
    return state;
  }

  console.log(`Update check started (${manual ? 'manual' : 'startup'}).`);
  setState({ phase: PHASES.CHECKING, error: null });

  let release;
  try {
    release = await provider.checkForUpdate();
  } catch (err) {
    console.error('Update check failed:', err.message);
    setState({
      phase: PHASES.ERROR,
      error: { message: 'Der Update-Check ist fehlgeschlagen.', phase: PHASES.CHECKING },
    });
    return state;
  }

  if (!release || typeof release.version !== 'string') {
    console.log('Update check result: no update available.');
    setState({ phase: PHASES.IDLE, release: null });
    return state;
  }

  if (!isNewerVersion(getCurrentVersion(), release.version)) {
    console.log(`Update check result: up to date (installed ${getCurrentVersion()}, feed ${release.version}).`);
    setState({ phase: PHASES.IDLE, release: null });
    return state;
  }

  console.log(`Update available: ${release.version} (${release.type || 'normal'}).`);
  setState({
    phase: PHASES.AVAILABLE,
    release,
    download: null,
    error: null,
    dismissedForSession: false,
    checkedAt: Date.now(),
  });
  return state;
}

// "Später": hides the banner for the rest of this process's lifetime, no
// download, no persistence. The next real app start re-checks fresh (a new
// process means this flag starts at false again), and a manual check
// during the same session already resets it via the AVAILABLE transition
// above, so an explicit "Nach Updates suchen" always shows its result.
function dismissForSession() {
  if (state.phase !== PHASES.AVAILABLE) return state;
  console.log(`Update ${state.release && state.release.version} dismissed for this session ("Später").`);
  setState({ dismissedForSession: true });
  return state;
}

async function acceptUpdate() {
  if (!state.release) return state;

  const release = state.release;
  console.log(`User accepted update ${release.version}. Starting download.`);
  setState({
    phase: PHASES.DOWNLOADING,
    download: { downloadedBytes: 0, totalBytes: release.sizeBytes || null, percent: 0 },
    error: null,
  });

  try {
    await provider.download(release, (progress) => setState({ download: progress }));
  } catch (err) {
    console.error('Update download failed:', err.message);
    setState({
      phase: PHASES.ERROR,
      error: { message: 'Das Update konnte nicht heruntergeladen werden.', phase: PHASES.DOWNLOADING },
    });
    return state;
  }

  console.log(`Update ${release.version} downloaded, ready to install.`);
  setState({ phase: PHASES.READY });
  return state;
}

// Retries whichever step actually failed: a failed check re-runs the
// check; a failed download re-attempts downloading the same already-known
// release rather than starting over from a fresh check.
async function retry() {
  if (state.error && state.error.phase === PHASES.DOWNLOADING && state.release) {
    return acceptUpdate();
  }
  return checkForUpdates({ manual: true });
}

function requestInstall() {
  if (state.phase !== PHASES.READY) {
    return { ok: false, reason: 'not-ready' };
  }
  if (isStreamLive()) {
    console.log('Installation blocked: stream is currently live.');
    return { ok: false, reason: 'stream-live' };
  }
  if (typeof performInstall !== 'function') {
    console.error('Install requested but no install handler is registered (not running under Electron?).');
    return { ok: false, reason: 'no-handler' };
  }

  console.log(`Installing update ${state.release && state.release.version} and restarting.`);
  setState({ phase: PHASES.INSTALLING });

  // Optional provider hook (see localTestProvider.markInstalled): lets the
  // Phase 2A test provider record "this simulated release is now handled"
  // right before the real restart below, so it stops re-offering the exact
  // same version forever. A real ProductionProvider has no equivalent — a
  // genuine install replaces the binary, and app.getVersion() alone
  // reflects that afterward — so this stays a no-op for it.
  if (typeof provider.markInstalled === 'function' && state.release) {
    provider.markInstalled(state.release.version);
  }

  // performInstall() (app.relaunch() + app.exit() in the real app) is
  // deliberately not called synchronously here: doing so risked killing the
  // process before the INSTALLING state above ever reached a connected
  // page's WebSocket, let alone gave a human time to read it. This short,
  // fixed pause is only there to make the "SYNSA wird neu gestartet"
  // message in the banner reliably visible before the restart happens —
  // it's UX timing, not new update logic. The try/catch has to live inside
  // the timeout callback itself: a throw from performInstall() happens
  // asynchronously, after requestInstall() has already returned, so a
  // try/catch around setTimeout() would never see it.
  setTimeout(() => {
    try {
      performInstall();
    } catch (err) {
      console.error('Installation preparation failed:', err.message);
      setState({
        phase: PHASES.ERROR,
        error: { message: 'Die Installation konnte nicht vorbereitet werden.', phase: PHASES.READY },
      });
    }
  }, INSTALL_RESTART_DELAY_MS);

  return { ok: true };
}

module.exports = {
  PHASES,
  init,
  setInstallHandler,
  onChange,
  getState,
  notifyStreamChanged,
  checkForUpdates,
  dismissForSession,
  acceptUpdate,
  retry,
  requestInstall,
};
