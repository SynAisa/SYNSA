// Twitch device code grant flow — how SYNSA links a Twitch account.
//
// Why this flow and not the authorization code flow it replaced: the
// authorization code flow needs a client *secret* to obtain and refresh
// tokens, and a secret cannot ship inside a desktop application. That is why
// every user previously had to register their own Twitch application and
// copy a client ID and secret into the setup screen. The device flow is
// built for exactly this situation — a public client with no secret — and
// still returns refresh tokens, so the connection survives restarts.
//
// The shape of it:
//   1. Ask Twitch for a device code. It answers with a short user code and
//      a verification URL.
//   2. The user opens that URL (in their real browser) and approves.
//   3. Meanwhile we poll Twitch until it hands over the tokens.
//
// The polling runs here, in the server, not in the page: the connection
// finishes even if the user closes the window while approving in the
// browser.
const config = require('./config');
const tokenStore = require('./tokenStore');

const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

// Twitch's own poll interval is in the device response; this is only the
// fallback if it is ever missing, and the step used when Twitch asks us to
// slow down.
const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_STEP_SECONDS = 5;

// status: 'idle' | 'waiting' | 'connected' | 'error'
let state = { status: 'idle', userCode: null, verificationUri: null, expiresAt: null, error: null };
let pollTimer = null;
let activeDeviceCode = null;

// Set by server.js — starts EventSub and broadcasts the new Twitch state,
// exactly the same steps the old OAuth callback performed on success.
let onConnected = async () => {};

function init({ onConnected: handler } = {}) {
  if (typeof handler === 'function') onConnected = handler;
}

function getState() {
  return { ...state, hasClientId: config.hasClientId };
}

function setState(patch) {
  state = { ...state, ...patch };
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  activeDeviceCode = null;
}

// Gives up on the current attempt. Called by the user ("Abbrechen"), and
// whenever a new attempt starts, so two flows can never poll at once.
function cancel() {
  stopPolling();
  setState({ status: 'idle', userCode: null, verificationUri: null, expiresAt: null, error: null });
  return getState();
}

async function start() {
  if (!config.hasClientId) {
    setState({ status: 'error', error: 'SYNSA hat keine Twitch-Client-ID hinterlegt.' });
    return getState();
  }

  // A second attempt replaces the first rather than racing it.
  stopPolling();

  const params = new URLSearchParams({
    client_id: config.clientId,
    scopes: config.scopes.join(' '),
  });

  const res = await fetch(DEVICE_URL, { method: 'POST', body: params });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.device_code) {
    const message = body.message || `Twitch antwortete mit ${res.status}`;
    setState({ status: 'error', userCode: null, verificationUri: null, expiresAt: null, error: message });
    console.error('Twitch device flow could not be started:', message);
    return getState();
  }

  activeDeviceCode = body.device_code;
  const intervalSeconds = Number(body.interval) > 0 ? Number(body.interval) : DEFAULT_INTERVAL_SECONDS;

  setState({
    status: 'waiting',
    userCode: body.user_code || null,
    verificationUri: body.verification_uri || null,
    expiresAt: Date.now() + (Number(body.expires_in) || 0) * 1000,
    error: null,
  });

  console.log('Twitch device flow started, waiting for the user to approve.');
  schedulePoll(body.device_code, intervalSeconds);

  return getState();
}

function schedulePoll(deviceCode, intervalSeconds) {
  pollTimer = setTimeout(() => poll(deviceCode, intervalSeconds), intervalSeconds * 1000);
}

async function poll(deviceCode, intervalSeconds) {
  // A cancel (or a newer attempt) happened while this poll was queued.
  if (deviceCode !== activeDeviceCode) return;

  if (state.expiresAt && Date.now() > state.expiresAt) {
    stopPolling();
    setState({ status: 'error', error: 'Der Code ist abgelaufen. Bitte erneut versuchen.' });
    return;
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    scopes: config.scopes.join(' '),
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  let res;
  let body;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', body: params });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    // A network hiccup is not a reason to abandon a flow the user may be
    // in the middle of approving — keep polling until the code expires.
    console.error('Twitch device flow poll failed:', err.message);
    schedulePoll(deviceCode, intervalSeconds);
    return;
  }

  if (deviceCode !== activeDeviceCode) return;

  if (res.ok && body.access_token) {
    stopPolling();
    tokenStore.save({ accessToken: body.access_token, refreshToken: body.refresh_token });
    setState({ status: 'connected', userCode: null, verificationUri: null, expiresAt: null, error: null });
    console.log('Twitch account connected via device flow.');

    try {
      await onConnected();
    } catch (err) {
      console.error('Starting Twitch after connecting failed:', err.message);
    }
    return;
  }

  const message = String(body.message || '');

  // The expected answer for as long as the user has not approved yet.
  if (message.includes('authorization_pending')) {
    schedulePoll(deviceCode, intervalSeconds);
    return;
  }

  // Twitch asks us to back off; polling faster than allowed would only get
  // us throttled harder.
  if (message.includes('slow_down')) {
    schedulePoll(deviceCode, intervalSeconds + SLOW_DOWN_STEP_SECONDS);
    return;
  }

  stopPolling();
  const readable = message.includes('access_denied')
    ? 'Die Verbindung wurde bei Twitch abgelehnt.'
    : message.includes('expired')
      ? 'Der Code ist abgelaufen. Bitte erneut versuchen.'
      : message || `Twitch antwortete mit ${res.status}`;
  setState({ status: 'error', userCode: null, verificationUri: null, expiresAt: null, error: readable });
  console.error('Twitch device flow failed:', message || res.status);
}

module.exports = { init, start, cancel, getState };
