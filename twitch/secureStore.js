const fs = require('fs');
const path = require('path');

// Twitch tokens and the client secret are the sensitive part of this app:
// they can post as you, ban viewers and change your channel. When running
// inside Electron we hand them to the OS keystore (DPAPI on Windows) so
// they're encrypted at rest and tied to this Windows user account, instead
// of sitting in a plainly readable file that a backup, a synced folder or
// another account on the machine could pick up.
//
// The plain `node server.js` dev flow has no Electron, so it falls back to
// plaintext — same as before. Files written either way stay readable by
// the other: reads sniff the format, and the next write upgrades it.
let safeStorage = null;
try {
  // In a plain Node process `require('electron')` resolves to a path
  // string, not the API — hence the shape check below.
  const electron = require('electron');
  if (electron && typeof electron === 'object') safeStorage = electron.safeStorage;
} catch {
  // not running under Electron
}

function canEncrypt() {
  return Boolean(
    safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
  );
}

function readJson(file) {
  const buffer = fs.readFileSync(file);
  const asText = buffer.toString('utf8');

  // Plaintext (older file, or written by the dev flow).
  if (asText.trimStart().startsWith('{')) {
    const data = JSON.parse(asText);

    // Migrate a file left over from before encryption existed, so secrets
    // don't keep sitting around readable.
    if (canEncrypt()) {
      try {
        writeJson(file, data);
      } catch {
        // Not worth failing the read over — it stays plaintext for now.
      }
    }

    return data;
  }

  if (!canEncrypt()) {
    throw new Error('File is encrypted but no keystore is available to read it');
  }
  return JSON.parse(safeStorage.decryptString(buffer));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const json = JSON.stringify(data, null, 2);

  if (canEncrypt()) {
    fs.writeFileSync(file, safeStorage.encryptString(json));
  } else {
    fs.writeFileSync(file, json, 'utf8');
  }
}

module.exports = { readJson, writeJson, canEncrypt };
