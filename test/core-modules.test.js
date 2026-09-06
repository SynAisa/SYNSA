const test = require('node:test');
const assert = require('node:assert/strict');

const { compareVersions, isNewerVersion } = require('../update/versionCompare');
const { isAuthorizationRevoked } = require('../twitch/revocation');
const spotifyAuth = require('../spotify/auth');

test('compares release versions in both directions', () => {
  assert.equal(compareVersions('0.2.1', '0.2.1'), 0);
  assert.equal(compareVersions('0.2.2', '0.2.1'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1);
  assert.equal(isNewerVersion('0.2.1', '0.2.2'), true);
});

test('recognizes only the exact Twitch authorization revocation reason', () => {
  assert.equal(isAuthorizationRevoked('authorization_revoked'), true);
  assert.equal(isAuthorizationRevoked('user_removed'), false);
});

test('a foreign Spotify callback cannot cancel an active PKCE flow', async () => {
  const authorizeUrl = new URL(spotifyAuth.buildAuthorizeUrl());
  const state = authorizeUrl.searchParams.get('state');

  assert.equal(spotifyAuth.hasPendingState(state), true);
  await assert.rejects(spotifyAuth.exchangeCode('', 'foreign-state'), /Ungültiger state-Parameter/);
  assert.equal(spotifyAuth.hasPendingState(state), true);

  spotifyAuth.cancel();
  assert.equal(spotifyAuth.hasPendingState(state), false);
});
