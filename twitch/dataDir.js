const path = require('path');

// In the plain `npm start` / node server.js flow this resolves to
// <project root>/data. The packaged tray app overrides
// SYNSA_DATA_DIR (set in electron/main.js) to a writable
// per-user folder, since the app itself may sit somewhere read-only.
function getDataDir() {
  return process.env.SYNSA_DATA_DIR || path.join(__dirname, '..', 'data');
}

module.exports = { getDataDir };
