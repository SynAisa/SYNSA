const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./dataDir');
const secureStore = require('./secureStore');

const FILE = path.join(getDataDir(), 'tokens.json');

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
