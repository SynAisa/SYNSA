const crypto = require('crypto');
const config = require('./config');
const tokenStore = require('./tokenStore');

// Authorization Code flow with PKCE — the right flow for a desktop app, and
// the same reasoning that made SYNSA a public Twitch client: there is no
// client secret to ship, so there is nothing here left to leak.
//
// Token refreshing mirrors twitch/helix.js exactly, including the shared
// in-flight promise: several callers hitting an expired token at once must
// not each spend the refresh token separately.

let pendingVerifier = null;
let pendingState = null;

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Starts a flow: returns the URL the system browser should open, and keeps
// the verifier around for the callback that follows.
function buildAuthorizeUrl() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64Url(crypto.randomBytes(16));

  pendingVerifier = verifier;
  pendingState = state;

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });

  return `${config.authorizeUrl}?${params.toString()}`;
}

function cancel() {
  pendingVerifier = null;
  pendingState = null;
}

// Called by the loopback callback route. Throws with a readable message
// rather than letting a Spotify error body reach the browser as-is.
async function exchangeCode(code, state) {
  if (!pendingVerifier) throw new Error('Es läuft gerade keine Spotify-Anmeldung');
  if (!state || state !== pendingState) {
    // A mismatch is never a retryable accident — drop the pending flow
    // rather than leaving a verifier lying around for a second attempt.
    cancel();
    throw new Error('Ungültiger state-Parameter');
  }

  const verifier = pendingVerifier;
  cancel();

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    throw new Error(`Spotify-Anmeldung fehlgeschlagen: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const tokens = {
    accessToken: body.access_token,
    // Spotify may omit a new refresh token on refresh; on the initial
    // exchange it is always there.
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };
  tokenStore.save(tokens);
  return tokens;
}

// Same failure split as twitch/helix.js refreshAccessToken(): a 400/401 from
// the token endpoint means this authorization is gone for good (the user
// revoked SYNSA in their Spotify account), anything else is temporary and
// worth retrying.
async function refreshAccessToken(refreshToken) {
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = new Error(`Spotify-Token-Erneuerung fehlgeschlagen: ${res.status} ${await res.text()}`);
    if (res.status === 400 || res.status === 401) err.authRevoked = true;
    throw err;
  }

  const body = await res.json();
  return {
    accessToken: body.access_token,
    // Keep the old one when Spotify doesn't rotate it.
    refreshToken: body.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
  };
}

let refreshInFlight = null;

function refreshTokens(currentRefreshToken) {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(currentRefreshToken)
      .then((tokens) => {
        tokenStore.save(tokens);
        return tokens;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Calls a Spotify Web API endpoint with the stored token, refreshing once if
// it expired. Same contract as twitch/helix.js's helixFetch: returns the
// Response, callers decide what a non-OK status means.
async function spotifyFetch(pathAndQuery) {
  const tokens = tokenStore.load();
  if (!tokens) throw new Error('Nicht mit Spotify verbunden');

  const doFetch = (accessToken) =>
    fetch(`${config.apiBase}${pathAndQuery}`, { headers: { Authorization: `Bearer ${accessToken}` } });

  // Refresh proactively when the token is known to be spent — Spotify's
  // access tokens last an hour and this poller runs for a whole stream.
  let active = tokens;
  if (!tokens.expiresAt || tokens.expiresAt <= Date.now() + 30000) {
    active = await refreshTokens(tokens.refreshToken);
  }

  let res = await doFetch(active.accessToken);
  if (res.status === 401) {
    const refreshed = await refreshTokens(active.refreshToken);
    res = await doFetch(refreshed.accessToken);
  }
  return res;
}

module.exports = { buildAuthorizeUrl, cancel, exchangeCode, refreshTokens, spotifyFetch };
