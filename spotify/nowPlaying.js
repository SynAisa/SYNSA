const auth = require('./auth');
const tokenStore = require('./tokenStore');

// Fills the exact same status shape music/companion.js produces, so
// overlay-music.html and state.music need no knowledge of where the track
// came from. Same init({ onStatus })/start()/stop()/isConnected() surface as
// the YTMDesktop module, so server.js can treat the two interchangeably.
//
// Polling rather than a socket: Spotify's Web API has no push for playback
// state. One request every few seconds is well inside the rate limit, and
// the overlay interpolates the progress bar between updates anyway (see
// renderProgress in public/js/overlay-music.js), so a slower poll is not
// visible as a stuttering bar.
const POLL_INTERVAL_MS = 4000;

const EMPTY_STATUS = {
  connected: false,
  title: null,
  artist: null,
  thumbnail: null,
  durationSeconds: 0,
  progressSeconds: 0,
  isPlaying: false,
};

let pollTimer = null;
let connected = false;
let onStatusCallback = () => {};

function init({ onStatus } = {}) {
  onStatusCallback = onStatus || (() => {});
}

function isConnected() {
  return connected;
}

function isPaired() {
  return Boolean(tokenStore.load());
}

// Largest image Spotify offers for the album — the overlay scales it down,
// and a 64px thumbnail stretched to the card looks exactly as bad as it
// sounds.
function pickCover(album) {
  const images = (album && album.images) || [];
  if (!images.length) return null;
  return images.reduce((best, img) => ((img.width || 0) > (best.width || 0) ? img : best), images[0]).url;
}

function mapTrack(body) {
  const item = body && body.item;
  // Podcasts and local files come back without the fields below; treating
  // them as "nothing playing" beats rendering a half-empty card.
  if (!item || !item.name) return { ...EMPTY_STATUS, connected: true };

  return {
    connected: true,
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    thumbnail: pickCover(item.album),
    durationSeconds: Math.round((item.duration_ms || 0) / 1000),
    progressSeconds: Math.round((body.progress_ms || 0) / 1000),
    isPlaying: Boolean(body.is_playing),
  };
}

async function poll() {
  try {
    const res = await auth.spotifyFetch('/me/player/currently-playing?additional_types=track');

    // 204: connected fine, just nothing playing right now.
    if (res.status === 204) {
      connected = true;
      onStatusCallback({ ...EMPTY_STATUS, connected: true });
      return;
    }

    if (!res.ok) {
      // 401/403 after a refresh attempt means the authorization is gone;
      // anything else is a hiccup worth waiting out.
      connected = false;
      onStatusCallback({ ...EMPTY_STATUS });
      if (res.status === 401 || res.status === 403) {
        console.error(`Spotify rejected the request (${res.status}) — reconnect needed.`);
        stop();
      }
      return;
    }

    connected = true;
    onStatusCallback(mapTrack(await res.json()));
  } catch (err) {
    connected = false;
    onStatusCallback({ ...EMPTY_STATUS });
    if (err.authRevoked) {
      console.error('Spotify authorization is no longer valid — stopping polling until reconnected.');
      stop();
      return;
    }
    console.error('Spotify poll failed:', err.message);
  }
}

function start() {
  if (pollTimer) return;
  if (!tokenStore.load()) return;
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  connected = false;
  onStatusCallback({ ...EMPTY_STATUS });
}

module.exports = { init, start, stop, poll, isConnected, isPaired };
