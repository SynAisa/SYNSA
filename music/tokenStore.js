const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../twitch/dataDir');
const secureStore = require('../twitch/secureStore');

const FILE = path.join(getDataDir(), 'music-tokens.json');

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
