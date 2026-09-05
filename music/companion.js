const { io } = require('socket.io-client');
const tokenStore = require('./tokenStore');

// YouTube Music Desktop App (YTMDesktop) exposes a local "Companion Server"
// REST + Socket.IO API for pairing and now-playing state. Same endpoints the
// standalone ytm-obs-overlay used to hit directly from the browser — moved
// here so the token lives once, encrypted, instead of per-OBS-source.
const HOST = '127.0.0.1';
const PORT = 9863;
const BASE = `http://${HOST}:${PORT}`;
// Deliberately NOT renamed: YTMDesktop ties the pairing token to this id,
// so changing it would silently invalidate an existing pairing and force
// the user to re-authorise. The display name below is the visible part.
const APP_ID = 'stream-alerts';
const APP_NAME = 'SYNSA';
const APP_VERSION = '1.0.0';
const PAIR_CONFIRM_TIMEOUT_MS = 30000;

let socket = null;
let onStatusCallback = () => {};

const EMPTY_STATUS = {
  connected: false,
  title: null,
  artist: null,
  thumbnail: null,
  durationSeconds: 0,
  progressSeconds: 0,
  isPlaying: false,
};

function init({ onStatus } = {}) {
  onStatusCallback = onStatus || (() => {});
}

function setStatus(status) {
  onStatusCallback(status);
}

async function requestJson(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${pathname} fehlgeschlagen (${res.status})`);
  }
  return res.json();
}

// Two-step pairing: request a code, then wait (up to ~30s) for the user to
// confirm the connection inside YTMDesktop itself.
async function pair() {
  let code;
  try {
    ({ code } = await requestJson('/api/v1/auth/requestcode', {
      appId: APP_ID,
      appName: APP_NAME,
      appVersion: APP_VERSION,
    }));
  } catch (err) {
    throw new Error(
      `Konnte YTMDesktop nicht erreichen (${err.message}). Läuft die App und ist der Companion Server aktiviert (Einstellungen -> Integrationen)?`
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAIR_CONFIRM_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/v1/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: APP_ID, code }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`request fehlgeschlagen (${res.status})`);
    const { token } = await res.json();
    return token;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Zeitüberschreitung — die Verbindung wurde nicht rechtzeitig in YTMDesktop bestätigt.');
    }
    throw new Error(`Anfrage wurde nicht bestätigt oder ist abgelaufen (${err.message}).`);
  } finally {
    clearTimeout(timeout);
  }
}

function mapState(state) {
  const video = state && state.video;
  const player = state && state.player;

  if (!video || !video.title) {
    return { ...EMPTY_STATUS, connected: true };
  }

  let thumbnail = '';
  if (Array.isArray(video.thumbnails) && video.thumbnails.length) {
    thumbnail = video.thumbnails.reduce((best, t) => ((t.width || 0) > (best.width || 0) ? t : best), video.thumbnails[0])
      .url;
  }

  return {
    connected: true,
    title: video.title || '',
    artist: video.author || '',
    thumbnail,
    durationSeconds: video.durationSeconds || 0,
    progressSeconds: (player && player.videoProgress) || 0,
    isPlaying: player ? player.trackState === 1 : false,
  };
}

function connect(token) {
  if (socket) socket.disconnect();

  socket = io(`${BASE}/api/v1/realtime`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
  });

  socket.on('connect', () => setStatus({ ...EMPTY_STATUS, connected: true }));
  socket.on('disconnect', () => setStatus(EMPTY_STATUS));
  socket.on('connect_error', () => setStatus(EMPTY_STATUS));
  socket.on('state-update', (state) => setStatus(mapState(state)));
}

function start() {
  const stored = tokenStore.load();
  if (stored && stored.companionToken) {
    connect(stored.companionToken);
  }
}

function stop() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  setStatus(EMPTY_STATUS);
}

function isConnected() {
  return Boolean(socket && socket.connected);
}

module.exports = { init, pair, connect, start, stop, isConnected };
