// ============================================================================
// PHASE 2A — LOCAL TEST PROVIDER. NOT A PRODUCTION UPDATE SOURCE.
// ============================================================================
//
// Simulates an update feed entirely in-process: no network requests, no
// GitHub API, no GitHub Releases, no external servers of any kind. This
// exists purely to exercise update/manager.js's state machine and the
// Dashboard/Settings UI end to end before a real ProductionProvider
// (GitHub Releases, Phase 2B) is built.
//
// A future ProductionProvider must implement the same two functions
// (checkForUpdate, download) with the same return shapes — see the
// "Provider contract" comment in update/manager.js. Nothing in
// UpdateManager, server.js, or the renderer pages needs to change when
// that swap happens; only manager.js's `require('./localTestProvider')`
// line is replaced.
//
// Every Phase 2A test scenario is driven by environment variables, so the
// full test matrix (normal update, no update, critical update, failed
// check, failed download) can be exercised without editing this file:
//
//   SYNSA_UPDATE_TEST_VERSION        simulated "latest" version (default "0.1.1")
//   SYNSA_UPDATE_TEST_TYPE           "normal" | "critical" (default "normal")
//   SYNSA_UPDATE_TEST_FAIL_CHECK     "1" makes checkForUpdate() reject
//   SYNSA_UPDATE_TEST_FAIL_DOWNLOAD  "1" makes download() reject partway through
//
// Setting SYNSA_UPDATE_TEST_VERSION to the app's own current version (or
// leaving it unset when the current version is already >= it) simulates
// "no update available" — see isNewerVersion() in update/manager.js, which
// is what actually decides that, not this provider.
//
// Test-only "already installed" marker: app.relaunch() after a real
// "Jetzt installieren" click is a genuine OS process restart, so anything
// held only in memory (like hasFailedDownloadOnce below) is wiped — without
// persisting *something*, the very next startup check would offer this
// exact same simulated release again forever (Phase 2A never actually
// installs a different binary, so package.json/app.getVersion() honestly
// keep reporting 0.1.0 the whole time; see markInstalled()). This is
// intentionally its own small file, not folded into config.json,
// tokens.json, or event-history.json — deleting it is the reset (TEST E):
//   <data dir>/local-test-update-state.json
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../twitch/dataDir');

const TEST_STATE_FILE = path.join(getDataDir(), 'local-test-update-state.json');

function readTestState() {
  try {
    return JSON.parse(fs.readFileSync(TEST_STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Called by update/manager.js's requestInstall() right before the real
// restart. Optional on the provider contract — a real ProductionProvider
// has no equivalent, since a genuine install replaces the binary itself
// and app.getVersion() alone reflects that afterward.
function markInstalled(version) {
  try {
    fs.mkdirSync(path.dirname(TEST_STATE_FILE), { recursive: true });
    fs.writeFileSync(TEST_STATE_FILE, JSON.stringify({ installedTestVersion: version }));
    console.log(`Local test provider: marked ${version} as installed (${TEST_STATE_FILE}).`);
  } catch (err) {
    console.error('Could not persist local test update state:', err.message);
  }
}

const SIMULATED_VERSION = process.env.SYNSA_UPDATE_TEST_VERSION || '0.1.1';
const SIMULATED_TYPE = process.env.SYNSA_UPDATE_TEST_TYPE === 'critical' ? 'critical' : 'normal';
const FAIL_CHECK = process.env.SYNSA_UPDATE_TEST_FAIL_CHECK === '1';
const FAIL_DOWNLOAD = process.env.SYNSA_UPDATE_TEST_FAIL_DOWNLOAD === '1';

// A fixed, clearly-fake size for the simulated download — there is no real
// artifact behind it. See the Phase 2A limitations note in the final report.
const SIMULATED_SIZE_BYTES = 58 * 1024 * 1024;

const RELEASE_NOTES = [
  'Testversion — lokaler Update-Test (Phase 2A), keine echte Veröffentlichung.',
  'Verbesserte Systemstabilität',
  'Kleinere Fehlerbehebungen',
  'Technische Verbesserungen',
];

const CHECK_DELAY_MS = 500;
const DOWNLOAD_TICK_MS = 350;
const DOWNLOAD_TICKS = 16; // ~5.6s total: fast to test, slow enough to see progress move

// Resolves with release metadata, or null if this simulated feed has
// nothing newer to offer. Real version comparison against the installed
// version happens in update/manager.js, not here — this only ever reports
// "what the feed currently has."
function checkForUpdate() {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (FAIL_CHECK) {
        reject(new Error('SIMULATED (SYNSA_UPDATE_TEST_FAIL_CHECK): lokaler Update-Check fehlgeschlagen'));
        return;
      }

      if (readTestState().installedTestVersion === SIMULATED_VERSION) {
        resolve(null);
        return;
      }

      resolve({
        version: SIMULATED_VERSION,
        type: SIMULATED_TYPE,
        notes: RELEASE_NOTES,
        sizeBytes: SIMULATED_SIZE_BYTES,
      });
    }, CHECK_DELAY_MS);
  });
}

// onProgress({ downloadedBytes, totalBytes, percent }). No real bytes ever
// move — this ticks a timer to simulate one, so the Dashboard's progress UI
// can be exercised without a real second build to fetch.
// Fails only the *first* download attempt per process when the test flag is
// set, then lets a retry succeed — this exercises the real "retry recovers"
// path (TEST 12) instead of requiring a restart to clear the failure.
let hasFailedDownloadOnce = false;

function download(release, onProgress) {
  return new Promise((resolve, reject) => {
    const totalBytes = release.sizeBytes || SIMULATED_SIZE_BYTES;
    const shouldFailThisAttempt = FAIL_DOWNLOAD && !hasFailedDownloadOnce;
    const failAtTick = shouldFailThisAttempt ? Math.floor(DOWNLOAD_TICKS * 0.6) : -1;
    let tick = 0;

    const timer = setInterval(() => {
      tick += 1;

      if (tick === failAtTick) {
        clearInterval(timer);
        hasFailedDownloadOnce = true;
        reject(new Error('SIMULATED (SYNSA_UPDATE_TEST_FAIL_DOWNLOAD): lokaler Download fehlgeschlagen'));
        return;
      }

      const downloadedBytes = Math.min(totalBytes, Math.round((totalBytes * tick) / DOWNLOAD_TICKS));
      onProgress({
        downloadedBytes,
        totalBytes,
        percent: Math.round((downloadedBytes / totalBytes) * 100),
      });

      if (tick >= DOWNLOAD_TICKS) {
        clearInterval(timer);
        resolve();
      }
    }, DOWNLOAD_TICK_MS);
  });
}

module.exports = { checkForUpdate, download, markInstalled, IS_LOCAL_TEST_PROVIDER: true };
