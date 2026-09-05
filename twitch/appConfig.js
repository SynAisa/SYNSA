const path = require('path');
const { getDataDir } = require('./dataDir');
const secureStore = require('./secureStore');

// Twitch app credentials (client id + secret). Two sources, in order:
//
//   1. environment variables — used by the `npm start` dev flow, where a
//      .env file sits in the project root, and
//   2. config.json in the data folder — written by the in-app setup page,
//      which is how the packaged .exe gets them. That keeps the secret out
//      of the executable itself: the .exe stays a plain, shareable-by-
//      accident binary with no credentials baked in.
const FILE = path.join(getDataDir(), 'config.json');

let cached = null;

function readFile() {
  if (cached) return cached;
  try {
    cached = secureStore.readJson(FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Could not read stored Twitch credentials:', err.message);
    }
    cached = {};
  }
  return cached;
}

function getCredentials() {
  const stored = readFile();
  return {
    clientId: process.env.TWITCH_CLIENT_ID || stored.clientId || '',
    clientSecret: process.env.TWITCH_CLIENT_SECRET || stored.clientSecret || '',
  };
}

function saveCredentials({ clientId, clientSecret }) {
  const data = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
  secureStore.writeJson(FILE, data);
  cached = data;
}

function isConfigured() {
  const { clientId, clientSecret } = getCredentials();
  return Boolean(clientId && clientSecret);
}

module.exports = { getCredentials, saveCredentials, isConfigured };
