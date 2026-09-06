// Remembers whether the first-run welcome has been completed. It deliberately
// has no version dependency: updates must never look like a fresh install.
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

// Existing 0.2.2 files stored a version. They are an acknowledgement by
// definition, so reading one migrates its meaning without rewriting private
// runtime data during startup.
function getWelcomedVersion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

function hasCompletedWelcome() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return parsed.completed === true || typeof parsed.version === 'string';
  } catch {
    return false;
  }
}

function markWelcomeCompleted() {
  try {
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ completed: true, completedAt: new Date().toISOString() }, null, 2));
    return true;
  } catch (err) {
    // Not being able to record this is not worth failing the app over — the
    // only consequence is being greeted again next start.
    console.error('Could not save welcome state:', err.message);
    return false;
  }
}

// The welcome screen is for a fresh install only. Keeping the optional
// argument preserves compatibility with callers from older builds.
function shouldWelcome() {
  return !hasCompletedWelcome();
}

module.exports = {
  getWelcomedVersion,
  hasCompletedWelcome,
  markWelcomeCompleted,
  // Compatibility for the one old caller while deployments transition.
  setWelcomedVersion: markWelcomeCompleted,
  shouldWelcome,
};
