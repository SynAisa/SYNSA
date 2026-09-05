const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./dataDir');
const secureStore = require('./secureStore');
const config = require('./config');

const FILE = path.join(getDataDir(), 'tokens.json');

// Tokens are only ever valid for the Twitch application they were issued to,
// so which one that was is stored alongside them. Anything issued to a
// different client ID — the per-user application SYNSA required before it
// switched to the device code flow, or a TWITCH_CLIENT_ID override used
// during development — is reported as "not connected" instead of being sent
// to Twitch, where it would only ever come back as 401 and look like a
// broken installation rather than an account that simply has to be linked
// again.
function load() {
  let stored;
  try {
    stored = secureStore.readJson(FILE);
  } catch {
    return null;
  }

  if (!stored || !stored.accessToken) return null;
  if (stored.clientId !== config.clientId) return null;

  return stored;
}

function save(tokens) {
  secureStore.writeJson(FILE, { ...tokens, clientId: config.clientId });
}

function clear() {
  try {
    fs.unlinkSync(FILE);
  } catch {
    // nothing to clear
  }
}

module.exports = { load, save, clear };
