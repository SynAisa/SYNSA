const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const twitchConfig = require('./twitch/config');
const appConfig = require('./twitch/appConfig');
const tokenStore = require('./twitch/tokenStore');
const helix = require('./twitch/helix');
const eventsub = require('./twitch/eventsub');
const seventv = require('./twitch/seventv');
const { getDataDir } = require('./twitch/dataDir');
const musicTokenStore = require('./music/tokenStore');
const music = require('./music/companion');
const update = require('./update/manager');
const welcomeState = require('./update/welcomeState');
const releaseNotes = require('./update/releaseNotes');

const PORT = process.env.PORT || 4242;

// "localhost" resolves to ::1 on Windows before 127.0.0.1, so binding to
// just one loopback address silently breaks half the clients (OBS included).
// One listener per family covers both.
const HOSTS = ['127.0.0.1', '::1'];

// Everything this server can do — post in chat as you, time out and ban
// viewers, change your stream title — is completely unauthenticated,
// because it is meant to be reachable only from this machine. Two things
// enforce that:
//   1. the listeners bind to loopback only, so nobody else on the
//      WiFi/LAN can reach it at all, and
//   2. requests that a *browser* could be tricked into making from some
//      other website (WebSocket handshakes, state-changing POSTs) must
//      carry a localhost Origin. Non-browser clients send no Origin and
//      are allowed — they can't be used for a drive-by attack.
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  `http://[::1]:${PORT}`,
]);

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const isStateChanging = req.method !== 'GET' && req.method !== 'HEAD';
  if (isStateChanging && !isAllowedOrigin(req.headers.origin)) {
    res.status(403).send('Forbidden: cross-origin request');
    return;
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// One WebSocket hub shared by both loopback listeners.
const wss = new WebSocketServer({ noServer: true });

const servers = HOSTS.map(() => {
  const srv = http.createServer(app);

  srv.on('upgrade', (req, socket, head) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return srv;
});

const clients = new Set();

// Small shared piece of server-side state, so a freshly (re)loaded overlay
// or control panel picks up the last known volume/Twitch status instead of
// resetting.
const state = {
  volume: 0.6,
  twitch: { connected: false, channel: null },
  stream: { live: false, startedAt: null },
  emotes: {},
  music: { connected: false, title: null, artist: null, thumbnail: null, durationSeconds: 0, progressSeconds: 0, isPlaying: false },
  // endsAt is the source of truth (an absolute timestamp), not durationSeconds
  // — that way every client (overlay, settings page, a reconnecting one)
  // computes the exact same remaining time regardless of when it asks.
  // durationSeconds/label/accentColor/fontSize double as the settings
  // page's last-used values, so the form doesn't reset itself after Start.
  countdown: { running: false, endsAt: null, durationSeconds: 600, label: 'Starting Soon', accentColor: '#35C9A8', fontSize: 'medium' },
  // Display options for overlay-music.html — separate from `music` above,
  // which is live playback data from YTMDesktop and gets wholesale
  // overwritten on every status update.
  musicSettings: { showCover: true, accentColor: '#35C9A8' },
  // Populated below once update.init() runs; present here mainly so its
  // shape is visible next to the rest of state at a glance.
  update: null,
};

// The event history (follows/subs/cheers/raids) is persisted to disk so it
// survives a server restart — the dashboard is meant to show everything
// that happened, not just what arrived since the last boot. Chat is far
// higher volume and only useful as recent context, so it stays in-memory
// and capped.
const DATA_DIR = getDataDir();
const EVENT_HISTORY_FILE = path.join(DATA_DIR, 'event-history.json');
const MAX_CHAT_HISTORY = 150;

// The whole file is rewritten on every single alert, so it has to stay
// small: uncapped, a channel that streams for months would end up
// re-serializing megabytes synchronously mid-raid. The dashboard only ever
// renders the last 200 rows anyway, so anything past this is invisible.
const MAX_EVENT_HISTORY = 500;

function loadEventHistory() {
  try {
    const loaded = JSON.parse(fs.readFileSync(EVENT_HISTORY_FILE, 'utf8'));
    return Array.isArray(loaded) ? loaded.slice(-MAX_EVENT_HISTORY) : [];
  } catch {
    return [];
  }
}

function writeEventHistory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(EVENT_HISTORY_FILE, JSON.stringify(eventHistory));
  } catch (err) {
    console.error('Could not save event history:', err.message);
  }
}

// A gift bomb records dozens of alerts back to back, and writing the whole
// file synchronously on each one blocks the event loop exactly when the
// overlay needs it most. Coalescing into one trailing write costs at most
// the last second of history if the app is killed outright.
const EVENT_HISTORY_SAVE_DEBOUNCE_MS = 1000;
let saveTimer = null;

function saveEventHistory() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeEventHistory();
  }, EVENT_HISTORY_SAVE_DEBOUNCE_MS);
}

// Don't let a pending write die with the process.
for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      writeEventHistory();
    }
  });
}

const eventHistory = loadEventHistory();
const chatHistory = [];

function pushChatHistory(item) {
  chatHistory.push(item);
  if (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
}

// --- Alert delivery ---------------------------------------------------------

// A plain broadcast only reaches overlays that happen to be connected at
// that instant, which silently drops alerts: OBS shuts a Browser Source
// down while its scene is hidden ("Shutdown source when not visible"), and
// every reconnect leaves a ~1.5s hole. Alerts therefore stay here until an
// overlay confirms it has them, and are replayed to the next one that
// registers. Past the window the moment has passed — replaying a follow
// from an hour ago mid-gameplay would be worse than dropping it.
const ALERT_REDELIVERY_WINDOW_MS = 2 * 60 * 1000;
const unacknowledgedAlerts = new Map();

// Only one overlay is "primary": it owns the sound and the queue-status
// reports. Otherwise a preview tab open next to the real OBS source plays
// every alert a second time and both fight over the dashboard's status.
const overlayClients = new Set();

function pruneUnacknowledgedAlerts() {
  const cutoff = Date.now() - ALERT_REDELIVERY_WINDOW_MS;
  for (const [id, item] of unacknowledgedAlerts) {
    if (item.recordedAt < cutoff) unacknowledgedAlerts.delete(id);
  }
}

function primaryOverlay() {
  return overlayClients.values().next().value || null;
}

function sendOverlayRoles() {
  const primary = primaryOverlay();
  for (const client of overlayClients) {
    if (client.readyState !== client.OPEN) continue;
    client.send(JSON.stringify({ kind: 'overlay-role', primary: client === primary }));
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ kind: 'state', state }));
  ws.send(JSON.stringify({ kind: 'event-history', events: eventHistory }));
  ws.send(JSON.stringify({ kind: 'chat-history', messages: chatHistory }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // An overlay announcing itself: it gets a primary/secondary role and,
    // if it is the primary, everything that was missed while no overlay
    // was listening.
    if (msg.kind === 'register' && msg.role === 'overlay') {
      overlayClients.add(ws);
      sendOverlayRoles();

      if (ws === primaryOverlay()) {
        pruneUnacknowledgedAlerts();
        for (const item of unacknowledgedAlerts.values()) {
          ws.send(JSON.stringify({ kind: 'alert', alert: item.alert, id: item.id }));
        }
      }
    }

    // The primary overlay confirming an alert made it into its queue.
    if (msg.kind === 'alert-ack' && typeof msg.id === 'string') {
      unacknowledgedAlerts.delete(msg.id);
    }

    // A control-panel client asks to fan an alert out to everyone
    // (the overlay included). Real Twitch EventSub events reach the same
    // recordAlert() function further down, via eventsub.init().
    if (msg.kind === 'trigger-alert' && msg.alert) {
      recordAlert(msg.alert);
    }

    // Test hook mirroring trigger-alert, for exercising the chat panel
    // without needing a live Twitch chat message.
    if (msg.kind === 'trigger-chat' && msg.message) {
      recordChatMessage({
        id: crypto.randomUUID(),
        userId: msg.message.userId || crypto.randomUUID(),
        username: msg.message.username || 'TestUser',
        color: msg.message.color || null,
        badges: msg.message.badges || [],
        fragments: msg.message.fragments || [{ type: 'text', text: msg.message.text || '', emoteId: null }],
        timestamp: Date.now(),
      });
    }

    // Test hook for exercising the music overlay without a real YTMDesktop
    // connection (mirrors trigger-alert/trigger-chat). Deliberately goes
    // through the same path as a real status update, so what it exercises
    // is the actual behaviour and not a parallel one.
    if (msg.kind === 'trigger-music' && msg.status) {
      applyMusicStatus({ ...state.music, ...msg.status, connected: true });
    }

    // Test hook mirroring trigger-alert/trigger-chat/trigger-music: exercises
    // the update system's stream lock (see update/manager.js) without a real
    // Twitch broadcast. Goes through the exact same state.stream + onStream
    // path a real EventSub stream.online/offline event uses, so this drives
    // the one existing live/offline state rather than adding a second one.
    if (msg.kind === 'trigger-stream' && msg.status) {
      state.stream = { ...state.stream, ...msg.status };
      broadcast({ kind: 'stream-status', status: state.stream });
      update.notifyStreamChanged();
    }

    if (msg.kind === 'set-volume' && typeof msg.volume === 'number') {
      state.volume = Math.max(0, Math.min(1, msg.volume));
      broadcast({ kind: 'volume', volume: state.volume });
    }

    if (msg.kind === 'send-chat-message' && typeof msg.text === 'string' && msg.text.trim()) {
      const broadcasterId = eventsub.getBroadcasterId();
      if (broadcasterId) {
        helix.sendChatMessage(broadcasterId, broadcasterId, msg.text.trim()).catch((err) => {
          console.error('Failed to send chat message:', err.message);
        });
      }
    }

    // The overlay is the only thing that actually knows when an alert
    // starts/finishes showing (it owns the queue timing) — it reports
    // that back so the dashboard can highlight what's live vs waiting.
    if (msg.kind === 'alert-status' && typeof msg.id === 'string' && typeof msg.status === 'string') {
      broadcast({ kind: 'event-status', id: msg.id, status: msg.status });
    }

    // msg.duration in seconds -> timeout; omitted -> permanent ban.
    if (msg.kind === 'moderate' && typeof msg.userId === 'string') {
      const broadcasterId = eventsub.getBroadcasterId();
      if (broadcasterId) {
        helix
          .banUser(broadcasterId, broadcasterId, { userId: msg.userId, duration: msg.duration })
          .catch((err) => {
            console.error('Moderation action failed:', err.message);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ kind: 'moderation-error', message: err.message }));
            }
          });
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    // Losing the primary overlay promotes the next one, so a preview tab
    // takes over the sound instead of nothing playing at all.
    if (overlayClients.delete(ws)) sendOverlayRoles();
  });
});

function broadcast(payload) {
  const raw = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(raw);
    }
  }
}

function recordAlert(alert) {
  const entry = { id: crypto.randomUUID(), timestamp: Date.now(), alert };
  eventHistory.push(entry);
  if (eventHistory.length > MAX_EVENT_HISTORY) {
    eventHistory.splice(0, eventHistory.length - MAX_EVENT_HISTORY);
  }
  saveEventHistory();

  // Held until an overlay acknowledges it — see ALERT_REDELIVERY_WINDOW_MS.
  unacknowledgedAlerts.set(entry.id, { id: entry.id, alert, recordedAt: entry.timestamp });
  pruneUnacknowledgedAlerts();

  // Same id on both messages: the dashboard can only tell "playing" from
  // "waiting" because the overlay's later alert-status reports carry it.
  broadcast({ kind: 'alert', alert, id: entry.id });
  broadcast({ kind: 'event-history-append', entry });
}

function recordChatMessage(message) {
  pushChatHistory(message);
  broadcast({ kind: 'chat-message', message });
}

eventsub.init({
  onAlert: (alert) => recordAlert(alert),
  onChat: (message) => recordChatMessage(message),
  onStatus: (status) => {
    // The emote map is big (thousands of entries on a large 7TV set) and
    // has its own home in state.emotes — keeping it on the status object
    // too meant every state snapshot and every status broadcast carried
    // the whole thing twice.
    const { emotes, ...twitchStatus } = status;
    state.twitch = twitchStatus;
    if (emotes) state.emotes = emotes;
    broadcast({ kind: 'twitch-status', status: twitchStatus });
    broadcast({ kind: 'emotes', map: state.emotes });

    // Warms the emote-picker cache the moment Twitch connects, instead of
    // waiting for someone to click the picker open and eat the ~3s Twitch
    // round-trip right then. Fire-and-forget: a failure here just means the
    // next actual /api/twitch/emotes request falls back to fetching it live.
    if (twitchStatus.connected && twitchStatus.broadcasterId) {
      getEmotePayload(twitchStatus.broadcasterId).catch((err) => {
        console.error('Emote cache warm-up failed:', err.message);
      });
    }
  },
  onStream: (status) => {
    state.stream = status;
    broadcast({ kind: 'stream-status', status });
    // A ready-and-waiting update must immediately reflect the stream lock
    // the instant it changes, not just at the moment it was downloaded.
    update.notifyStreamChanged();
  },
});

// With YTMDesktop closed, socket.io retries forever and every failed
// attempt reports the same "nothing playing" status — without the equality
// check the overlay and dashboard would get a pointless message every few
// seconds, indefinitely. Progress ticks genuinely differ, so they pass.
function applyMusicStatus(status) {
  const changed = Object.keys(status).some((key) => state.music[key] !== status[key]);
  if (!changed) return;

  state.music = status;
  broadcast({ kind: 'music-status', status });
}

music.init({ onStatus: applyMusicStatus });

// --- Updates (Phase 2A: local test provider only) ---------------------------

// getCurrentVersion reads package.json directly rather than caching it, so
// it stays correct even across the in-place restart a real install would
// perform. isStreamLive reuses the *existing* Twitch live/offline state
// (state.stream, set by eventsub's onStream below) instead of creating a
// second, independent implementation.
update.init({
  getCurrentVersion: () => require('./package.json').version,
  isStreamLive: () => state.stream.live,
});
state.update = update.getState();
update.onChange((updateState) => {
  state.update = updateState;
  broadcast({ kind: 'update-status', status: updateState });
});

// --- Twitch OAuth (Authorization Code flow) -------------------------------

// A single slot meant a second login attempt invalidated the first, so
// whichever tab the user actually completed could fail with "invalid
// state". Several may now be in flight; each is single-use and expires.
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const pendingOAuthStates = new Map();

function issueOAuthState() {
  const value = crypto.randomBytes(16).toString('hex');
  const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
  for (const [existing, createdAt] of pendingOAuthStates) {
    if (createdAt < cutoff) pendingOAuthStates.delete(existing);
  }
  pendingOAuthStates.set(value, Date.now());
  return value;
}

function consumeOAuthState(value) {
  if (typeof value !== 'string' || !pendingOAuthStates.has(value)) return false;
  const createdAt = pendingOAuthStates.get(value);
  pendingOAuthStates.delete(value);
  return Date.now() - createdAt < OAUTH_STATE_TTL_MS;
}

// Single source of truth for the version shown in the UI (module menu,
// window title) — reads package.json rather than duplicating the number.
app.get('/api/version', (req, res) => {
  res.json({ version: require('./package.json').version });
});

// --- Updates (Phase 2A: local test provider only, see update/manager.js) ---

app.get('/api/update/status', (req, res) => {
  res.json(update.getState());
});

app.post('/api/update/check', async (req, res) => {
  const result = await update.checkForUpdates({ manual: true });
  res.json(result);
});

app.post('/api/update/dismiss', (req, res) => {
  res.json(update.dismissForSession());
});

app.post('/api/update/accept', async (req, res) => {
  const result = await update.acceptUpdate();
  res.json(result);
});

app.post('/api/update/retry', async (req, res) => {
  const result = await update.retry();
  res.json(result);
});

const INSTALL_BLOCKED_MESSAGES = {
  'not-ready': 'Das Update ist noch nicht bereit.',
  'stream-live': 'Das Update kann während eines laufenden Streams nicht installiert werden.',
  'no-handler': 'Die Installation ist in dieser Umgebung nicht verfügbar.',
  failed: 'Die Installation konnte nicht vorbereitet werden.',
};

app.post('/api/update/install', (req, res) => {
  const result = update.requestInstall();
  if (!result.ok) {
    res.status(409).json({ ok: false, reason: result.reason, message: INSTALL_BLOCKED_MESSAGES[result.reason] });
    return;
  }
  res.json({ ok: true });
});

// --- Welcome screen (first start, and again after every update) ------------

// Marks the running version as "the user has seen the welcome screen for
// this one", which is what stops it reappearing on every ordinary start.
// Written here rather than in the page so the format stays in one module
// (update/welcomeState.js), shared with electron/main.js which reads it.
app.post('/api/welcome/seen', (req, res) => {
  const version = require('./package.json').version;
  res.json({ ok: welcomeState.setWelcomedVersion(version), version });
});

// The changelog box on the welcome screen. GitHub's release list is the
// single source of truth — the same release bodies the update banner already
// shows — so there is no second changelog file to keep in sync. Owner and
// repo come from the publish configuration rather than being written out
// again here.
const CHANGELOG_CACHE_MS = 15 * 60 * 1000;
const CHANGELOG_TIMEOUT_MS = 8000;
const CHANGELOG_LIMIT = 10;
let changelogCache = { fetchedAt: 0, entries: null };

app.get('/api/changelog', async (req, res) => {
  const now = Date.now();
  if (changelogCache.entries && now - changelogCache.fetchedAt < CHANGELOG_CACHE_MS) {
    res.json({ entries: changelogCache.entries, currentVersion: require('./package.json').version });
    return;
  }

  const { owner, repo } = require('./package.json').build.publish;

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=${CHANGELOG_LIMIT}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SYNSA' },
      signal: AbortSignal.timeout(CHANGELOG_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub antwortete mit ${response.status}`);

    const entries = (await response.json())
      .filter((release) => !release.draft)
      .map((release) => {
        // Tags are "v0.1.5"; the leading v is presentation, not part of the version.
        const version = String(release.tag_name || '').replace(/^v/, '');
        const notes = releaseNotes.toLines(release.body, { limit: 12 });

        // Release bodies open with a "SYNSA 0.1.5" heading line, which the
        // changelog entry already shows as its own headline — repeating it as
        // the first bullet just wastes a line in a small window.
        if (notes.length > 0 && notes[0].replace(/\s+/g, ' ').trim().toLowerCase() === `synsa ${version}`.toLowerCase()) {
          notes.shift();
        }

        return { version, publishedAt: release.published_at || null, notes };
      })
      .filter((entry) => entry.version);

    changelogCache = { fetchedAt: now, entries };
    res.json({ entries, currentVersion: require('./package.json').version });
  } catch (err) {
    // No changelog is not an error worth blocking the welcome screen over —
    // the page hides the box and lets the user continue (offline first start,
    // GitHub unreachable, rate limit).
    console.error('Changelog konnte nicht geladen werden:', err.message);
    res.json({ entries: [], unavailable: true, currentVersion: require('./package.json').version });
  }
});

// --- First-run setup (Twitch app credentials) ------------------------------

app.get('/api/setup/status', (req, res) => {
  res.json({ configured: appConfig.isConfigured(), redirectUri: twitchConfig.redirectUri });
});

app.post('/api/setup/credentials', (req, res) => {
  const clientId = typeof req.body.clientId === 'string' ? req.body.clientId : '';
  const clientSecret = typeof req.body.clientSecret === 'string' ? req.body.clientSecret : '';

  if (!clientId.trim() || !clientSecret.trim()) {
    res.status(400).json({ error: 'Client ID und Client Secret werden beide benötigt.' });
    return;
  }

  try {
    appConfig.saveCredentials({ clientId, clientSecret });
    res.json({ ok: true });
  } catch (err) {
    console.error('Could not save credentials:', err.message);
    res.status(500).json({ error: err.message });
    return;
  }

  // Tokens from a previous run stay valid across a credential re-entry, so
  // reconnect right away instead of making the user log in again.
  if (tokenStore.load()) {
    eventsub.start().catch((err) => {
      console.error('Could not start Twitch EventSub after setup:', err.message);
    });
  }
});

app.get('/auth/twitch/login', (req, res) => {
  if (!appConfig.isConfigured()) {
    res.redirect('/setup.html');
    return;
  }

  const params = new URLSearchParams({
    client_id: twitchConfig.clientId,
    redirect_uri: twitchConfig.redirectUri,
    response_type: 'code',
    scope: twitchConfig.scopes.join(' '),
    state: issueOAuthState(),
    force_verify: 'true',
  });

  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get('/auth/twitch/callback', async (req, res) => {
  const { code, state: returnedState, error, error_description: errorDescription } = req.query;

  if (error) {
    res.status(400).send(`Twitch-Autorisierung abgelehnt: ${errorDescription || error}`);
    return;
  }

  if (!consumeOAuthState(returnedState)) {
    res.status(400).send('Ungültiger OAuth-State. Bitte den Login erneut starten.');
    return;
  }

  try {
    const tokenResponse = await helix.exchangeCode(code);
    tokenStore.save({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
    });
    await eventsub.start();
    res.redirect('/control.html?twitch=connected');
  } catch (err) {
    console.error('Twitch OAuth callback failed:', err);
    res.status(500).send('Login fehlgeschlagen. Details stehen in der Server-Konsole.');
  }
});

app.post('/auth/twitch/logout', (req, res) => {
  eventsub.stop();
  tokenStore.clear();
  res.redirect('/control.html');
});

app.get('/api/twitch/status', (req, res) => {
  res.json(state.twitch);
});

// --- Stream info (title / category) ---------------------------------------

app.get('/api/twitch/channel', async (req, res) => {
  const broadcasterId = eventsub.getBroadcasterId();
  if (!broadcasterId) {
    res.status(409).json({ error: 'Nicht mit Twitch verbunden' });
    return;
  }

  try {
    const info = await helix.getChannelInfo(broadcasterId);
    res.json({ title: info.title, gameId: info.game_id, gameName: info.game_name });
  } catch (err) {
    console.error('Get channel info failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/twitch/channel', async (req, res) => {
  const broadcasterId = eventsub.getBroadcasterId();
  if (!broadcasterId) {
    res.status(409).json({ error: 'Nicht mit Twitch verbunden' });
    return;
  }

  try {
    await helix.updateChannelInfo(broadcasterId, { title: req.body.title, gameId: req.body.gameId });
    res.json({ ok: true });
  } catch (err) {
    console.error('Update channel info failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/twitch/categories', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) {
    res.json([]);
    return;
  }

  try {
    const results = await helix.searchCategories(query);
    res.json(
      results.map((g) => ({
        id: g.id,
        name: g.name,
        boxArtUrl: g.box_art_url.replace('{width}', '40').replace('{height}', '53'),
      }))
    );
  } catch (err) {
    console.error('Search categories failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Emote picker (Twitch subscription emotes + 7TV) -----------------------

// --- Emote picker cache ------------------------------------------------------

// Measured directly: helix.getUserEmotes() alone takes 3+ seconds on an
// account with a few hundred emotes, because Twitch paginates ~100 per page
// and each page depends on the previous page's cursor, so it can't be
// parallelized. Which emotes an account can use barely ever changes (a new
// sub or a channel adding an emote), so redoing that full fetch on every
// single first open of the picker — which is exactly what "first load is
// slow" was — is pure waste. The assembled payload is cached and pre-warmed
// the moment Twitch connects (see eventsub onStatus below), so by the time
// anyone actually opens the picker it's normally already sitting there.
const EMOTE_CACHE_TTL_MS = 30 * 60 * 1000;
let emoteCache = null;
let emoteCacheAt = 0;
let emoteFetchInFlight = null;

function getEmotePayload(broadcasterId) {
  if (emoteCache && Date.now() - emoteCacheAt < EMOTE_CACHE_TTL_MS) {
    return Promise.resolve(emoteCache);
  }
  if (!emoteFetchInFlight) {
    emoteFetchInFlight = fetchEmotePayload(broadcasterId)
      .then((payload) => {
        emoteCache = payload;
        emoteCacheAt = Date.now();
        return payload;
      })
      .finally(() => {
        emoteFetchInFlight = null;
      });
  }
  return emoteFetchInFlight;
}

async function fetchEmotePayload(broadcasterId) {
  const { emotes, template } = await helix.getUserEmotes(broadcasterId);

  const ownerIds = emotes.map((e) => e.owner_id).filter((id) => /^\d+$/.test(id) && id !== '0');
  const users = await helix.getUsersByIds(ownerIds);
  const nameById = new Map(users.map((u) => [u.id, u.display_name]));

  const groups = new Map();

  for (const emote of emotes) {
    const ownerId = emote.owner_id || '0';
    const ownerName = ownerId === '0' ? 'Twitch' : nameById.get(ownerId) || 'Unbekannt';

    if (!groups.has(ownerId)) {
      groups.set(ownerId, { ownerId, ownerName, emotes: [] });
    }

    const format = emote.format && emote.format.includes('animated') ? 'animated' : 'static';
    const url = template
      .replace('{{id}}', emote.id)
      .replace('{{format}}', format)
      .replace('{{theme_mode}}', 'dark')
      .replace('{{scale}}', '2.0');

    groups.get(ownerId).emotes.push({ id: emote.id, name: emote.name, url });
  }

  return [...groups.values()].sort((a, b) => {
    const rank = (g) => (g.ownerId === broadcasterId ? 0 : g.ownerId === '0' ? 1 : 2);
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.ownerName.localeCompare(b.ownerName);
  });
}

app.get('/api/twitch/emotes', async (req, res) => {
  const broadcasterId = eventsub.getBroadcasterId();
  if (!broadcasterId) {
    res.status(409).json({ error: 'Nicht mit Twitch verbunden' });
    return;
  }

  try {
    const twitchGroups = await getEmotePayload(broadcasterId);
    // 7TV emotes are already an in-memory map (refreshed on connect), so
    // reading them fresh here costs nothing and needs no cache of its own.
    res.json({ twitch: twitchGroups, sevenTv: seventv.getGrouped() });
  } catch (err) {
    console.error('Get emotes failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Chatters (who's currently in chat) -------------------------------------

// Who's a mod/VIP/sub barely changes during a stream, but each of these is
// a paginated crawl (subscribers 100 at a time), and the dashboard asks for
// the chatter list every minute. Caching the roles turns that minute tick
// into a single chatters call instead of four full crawls.
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
let roleCache = { broadcasterId: null, fetchedAt: 0, moderatorIds: null, vipIds: null, subscriberIds: null };

// Shared so two chatter requests arriving on a cold cache don't both kick
// off the same three paginated crawls.
let roleFetchInFlight = null;

function getRoleIds(broadcasterId) {
  const fresh =
    roleCache.broadcasterId === broadcasterId && Date.now() - roleCache.fetchedAt < ROLE_CACHE_TTL_MS;
  if (fresh) return Promise.resolve(roleCache);

  if (!roleFetchInFlight) {
    roleFetchInFlight = fetchRoleIds(broadcasterId).finally(() => {
      roleFetchInFlight = null;
    });
  }
  return roleFetchInFlight;
}

async function fetchRoleIds(broadcasterId) {
  const [moderators, vips, subscribers] = await Promise.all([
    helix.getModerators(broadcasterId).catch((err) => {
      console.error('Get moderators failed:', err.message);
      return [];
    }),
    helix.getVips(broadcasterId).catch((err) => {
      console.error('Get VIPs failed:', err.message);
      return [];
    }),
    helix.getSubscribers(broadcasterId).catch((err) => {
      console.error('Get subscribers failed:', err.message);
      return [];
    }),
  ]);

  roleCache = {
    broadcasterId,
    fetchedAt: Date.now(),
    moderatorIds: new Set(moderators.map((m) => m.user_id)),
    vipIds: new Set(vips.map((v) => v.user_id)),
    subscriberIds: new Set(subscribers.map((s) => s.user_id)),
  };
  return roleCache;
}

app.get('/api/twitch/chatters', async (req, res) => {
  const broadcasterId = eventsub.getBroadcasterId();
  if (!broadcasterId) {
    res.status(409).json({ error: 'Nicht mit Twitch verbunden' });
    return;
  }

  try {
    const [{ chatters, total }, { moderatorIds, vipIds, subscriberIds }] = await Promise.all([
      helix.getChatters(broadcasterId, broadcasterId),
      getRoleIds(broadcasterId),
    ]);

    const annotated = chatters
      .map((c) => {
        let role = 'viewer';
        if (c.user_id === broadcasterId) role = 'broadcaster';
        else if (moderatorIds.has(c.user_id)) role = 'moderator';
        else if (vipIds.has(c.user_id)) role = 'vip';
        else if (subscriberIds.has(c.user_id)) role = 'subscriber';

        return { id: c.user_id, name: c.user_name, login: c.user_login, role };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ total, chatters: annotated });
  } catch (err) {
    console.error('Get chatters failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- YTMDesktop (Now Playing) ------------------------------------------------

app.get('/api/music/status', (req, res) => {
  res.json({ paired: Boolean(musicTokenStore.load()), connected: music.isConnected() });
});

app.post('/api/music/pair', async (req, res) => {
  try {
    const companionToken = await music.pair();
    musicTokenStore.save({ companionToken });
    music.connect(companionToken);
    res.json({ ok: true });
  } catch (err) {
    console.error('YTMDesktop pairing failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/music/unpair', (req, res) => {
  music.stop();
  musicTokenStore.clear();
  res.json({ ok: true });
});

// Display options only (cover on/off, accent colour) — kept across restarts
// for the same reason as the countdown's settings, just a plain named file
// since there's no time-sensitive field like endsAt here to reconcile.
const MUSIC_SETTINGS_FILE = path.join(DATA_DIR, 'music-settings.json');

function loadMusicSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(MUSIC_SETTINGS_FILE, 'utf8'));
    return { ...state.musicSettings, ...saved };
  } catch {
    return state.musicSettings;
  }
}

function saveMusicSettings() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MUSIC_SETTINGS_FILE, JSON.stringify(state.musicSettings));
  } catch (err) {
    console.error('Could not save music settings:', err.message);
  }
}

state.musicSettings = loadMusicSettings();

app.get('/api/music/settings', (req, res) => {
  res.json(state.musicSettings);
});

app.post('/api/music/settings', (req, res) => {
  const showCover = typeof req.body.showCover === 'boolean' ? req.body.showCover : state.musicSettings.showCover;
  const accentColor = HEX_COLOR_RE.test(req.body.accentColor) ? req.body.accentColor : state.musicSettings.accentColor;

  state.musicSettings = { showCover, accentColor };
  saveMusicSettings();
  broadcast({ kind: 'music-settings', settings: state.musicSettings });
  res.json({ ok: true });
});

// --- Countdown ("Starting Soon") --------------------------------------------

// Settings are worth keeping across restarts (nobody wants to re-enter
// their label and colour), and because endsAt is an absolute timestamp a
// countdown that was running survives a crash mid-"starting soon" too —
// one that already expired while the app was down comes back stopped.
const COUNTDOWN_FILE = path.join(DATA_DIR, 'countdown.json');

function loadCountdown() {
  try {
    const saved = JSON.parse(fs.readFileSync(COUNTDOWN_FILE, 'utf8'));
    const expired = !saved.endsAt || saved.endsAt <= Date.now();
    return { ...state.countdown, ...saved, running: Boolean(saved.running) && !expired };
  } catch {
    return state.countdown;
  }
}

function saveCountdown() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COUNTDOWN_FILE, JSON.stringify(state.countdown));
  } catch (err) {
    console.error('Could not save countdown:', err.message);
  }
}

state.countdown = loadCountdown();

const COUNTDOWN_FONT_SIZES = new Set(['small', 'medium', 'large']);
const MAX_COUNTDOWN_SECONDS = 24 * 60 * 60;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

app.get('/api/countdown/status', (req, res) => {
  res.json(state.countdown);
});

app.post('/api/countdown/start', (req, res) => {
  const durationSeconds = Math.round(Number(req.body.durationSeconds));
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_COUNTDOWN_SECONDS) {
    res.status(400).json({ error: 'Ungültige Dauer' });
    return;
  }

  // Falling back on empty matters: reloading the settings page mid-run
  // leaves the label field blank (the form only pre-fills while stopped),
  // so a plain "is it a string" check would wipe the label on restart.
  const trimmedLabel = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 60) : '';
  const label = trimmedLabel || state.countdown.label;
  const accentColor = HEX_COLOR_RE.test(req.body.accentColor) ? req.body.accentColor : state.countdown.accentColor;
  const fontSize = COUNTDOWN_FONT_SIZES.has(req.body.fontSize) ? req.body.fontSize : state.countdown.fontSize;

  state.countdown = {
    running: true,
    endsAt: Date.now() + durationSeconds * 1000,
    durationSeconds,
    label,
    accentColor,
    fontSize,
  };
  saveCountdown();
  broadcast({ kind: 'countdown-status', status: state.countdown });
  res.json({ ok: true });
});

app.post('/api/countdown/stop', (req, res) => {
  state.countdown = { ...state.countdown, running: false, endsAt: null };
  saveCountdown();
  broadcast({ kind: 'countdown-status', status: state.countdown });
  res.json({ ok: true });
});

function listenOn(srv, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(Object.assign(err, { host }));
    srv.once('error', onError);
    srv.listen(PORT, host, () => {
      srv.off('error', onError);
      srv.on('error', (err) => console.error(`HTTP server error (${host}):`, err.message));
      resolve(host);
    });
  });
}

// Resolves once the port is bound on at least one loopback address, and
// rejects only if none of them worked (most often because another copy of
// the app is already running). The tray app awaits this so it can show a
// real error instead of dying silently. A machine with IPv6 disabled
// failing on ::1 is fine as long as 127.0.0.1 came up.
const ready = (async () => {
  const results = await Promise.allSettled(servers.map((srv, i) => listenOn(srv, HOSTS[i])));
  const bound = results.filter((r) => r.status === 'fulfilled');

  if (!bound.length) {
    throw results[0].reason;
  }

  for (const failed of results.filter((r) => r.status === 'rejected')) {
    console.warn(`Could not bind ${failed.reason.host}: ${failed.reason.message}`);
  }

  console.log(`SYNSA server running on http://localhost:${PORT}`);
  console.log(`  Overlay (OBS Browser Source): http://localhost:${PORT}/overlay.html`);
  console.log(`  Control Panel:                http://localhost:${PORT}/control.html`);
  console.log(`  Dashboard (Chat + Verlauf):    http://localhost:${PORT}/dashboard.html`);

  if (tokenStore.load()) {
    try {
      await eventsub.start();
    } catch (err) {
      console.error('Could not start Twitch EventSub on boot:', err.message);
    }
  }

  if (musicTokenStore.load()) {
    try {
      music.start();
    } catch (err) {
      console.error('Could not start YTMDesktop connection on boot:', err.message);
    }
  }
})();

module.exports = { ready, port: PORT };
