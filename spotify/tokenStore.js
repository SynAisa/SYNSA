const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../twitch/dataDir');
const secureStore = require('../twitch/secureStore');

// Same shape and same encryption as twitch/tokenStore.js and
// music/tokenStore.js — a Spotify refresh token is exactly as worth
// protecting as the others, so it goes through the OS keystore too.
const FILE = path.join(getDataDir(), 'spotify-tokens.json');

function load() {
  try {
    return secureStore.readJson(FILE);
  } catch {
    return null;
  }
}

function save(tokens) {
  secureStore.writeJson(FILE, tokens);
}

function clear() {
  try {
    fs.unlinkSync(FILE);
  } catch {
    // nothing to clear
  }
}

module.exports = { load, save, clear };
