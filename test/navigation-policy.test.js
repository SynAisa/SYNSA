const test = require('node:test');
const assert = require('node:assert/strict');

const { isInternalAppUrl } = require('../electron/navigation-policy');

const BASE_URL = 'http://localhost:4242';

test('allows only URLs on the exact SYNSA origin', () => {
  assert.equal(isInternalAppUrl('http://localhost:4242/dashboard.html', BASE_URL), true);
  assert.equal(isInternalAppUrl('http://localhost:4242.evil.example/', BASE_URL), false);
  assert.equal(isInternalAppUrl('http://localhost:4243/dashboard.html', BASE_URL), false);
  assert.equal(isInternalAppUrl('https://localhost:4242/dashboard.html', BASE_URL), false);
  assert.equal(isInternalAppUrl('not a URL', BASE_URL), false);
});
