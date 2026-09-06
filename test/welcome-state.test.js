const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const welcomeState = require('../update/welcomeState');

test('shows welcome only for a fresh data directory and accepts legacy version state', () => {
  const previous = process.env.SYNSA_DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synsa-welcome-'));
  process.env.SYNSA_DATA_DIR = dataDir;

  try {
    assert.equal(welcomeState.shouldWelcome(), true);
    fs.writeFileSync(path.join(dataDir, 'welcome-state.json'), JSON.stringify({ version: '0.2.2' }));
    assert.equal(welcomeState.shouldWelcome(), false);
    assert.equal(welcomeState.markWelcomeCompleted(), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'welcome-state.json'), 'utf8')).completed, true);
  } finally {
    if (previous === undefined) delete process.env.SYNSA_DATA_DIR;
    else process.env.SYNSA_DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
