// Remembers which SYNSA version the user has already been welcomed by, so the
// welcome screen appears on a fresh installation and again after every update
// — but not on every ordinary start.
//
// Read by electron/main.js when deciding which window to open, written by
// server.js when the user actually clicks "Weiter". Both go through this one
// module rather than each knowing the file format. Deliberately its own small
// file next to the other runtime state in the data directory, exactly like
// update/localTestProvider.js's state file: deleting it simply means being
// greeted once more, nothing else.
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../twitch/dataDir');

// Resolved per call, not once at require time: SYNSA_DATA_DIR is set by
// electron/main.js and may not be in place yet when this module is first
// loaded.
function stateFile() {
  return path.join(getDataDir(), 'welcome-state.json');
}

// null when the user has never completed the welcome screen (fresh install,
// or the file was removed).
function getWelcomedVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function setWelcomedVersion(version) {
  try {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version, seenAt: new Date().toISOString() }, null, 2));
    return true;
  } catch (err) {
    // Not being able to record this is not worth failing the app over — the
    // only consequence is being greeted again next start.
    console.error('Could not save welcome state:', err.message);
    return false;
  }
}

// The welcome screen is shown for a version the user has not acknowledged yet:
// a fresh install (nothing recorded) or a version that changed since.
function shouldWelcome(currentVersion) {
  return getWelcomedVersion() !== currentVersion;
}

module.exports = { getWelcomedVersion, setWelcomedVersion, shouldWelcome };
