const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const twitchConfig = require('./twitch/config');
const deviceAuth = require('./twitch/deviceAuth');
const tokenStore = require('./twitch/tokenStore');
const helix = require('./twitch/helix');
const eventsub = require('./twitch/eventsub');
const seventv = require('./twitch/seventv');
const { getDataDir } = require('./twitch/dataDir');
const musicTokenStore = require('./music/tokenStore');
const music = require('./music/companion');
const spotifyConfig = require('./spotify/config');
const spotifyTokenStore = require('./spotify/tokenStore');
const spotifyAuth = require('./spotify/auth');
const spotify = require('./spotify/nowPlaying');
const update = require('./update/manager');
const welcomeState = require('./update/welcomeState');
const releaseNotes = require('./update/releaseNotes');
const updateRepository = require('./update/repository');

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
  // reauthRequired stays null in normal operation and becomes
  // { reason, since } once Twitch has rejected this authorization for good —
  // see twitch/eventsub.js markAuthRevoked(). It is what tells "not connected
  // right now" apart from "needs to be linked again".
  twitch: { connected: false, channel: null, reauthRequired: null },
  stream: { live: false, startedAt: null },
  emotes: {},
  music: { connected: false, title: null, artist: null, thumbnail: null, durationSeconds: 0, progressSeconds: 0, isPlaying: false },
  // endsAt is the source of truth (an absolute timestamp), not durationSeconds
  // — that way every client (overlay, settings page, a reconnecting one)
  // computes the exact same remaining time regardless of when it asks.
  // durationSeconds/label/accentColor/fontSize double as the settings
  // page's last-used values, so the form doesn't reset itself after Start.
  countdown: { running: false, endsAt: null, durationSeconds: 600, label: 'Starting Soon', accentColor: '#35C9A8', fontSize: 'medium' },
  // A SYNSA-internal stream goal, counted from the alerts that already flow
  // through recordAlert() — deliberately not Twitch's own Creator Goals
  // (channel.goal.*), whose EventSub types only cover followers and
  // tier-weighted subscriptions, so a bits or gift-sub goal is impossible
  // there. target 0 means "nothing set up yet" and keeps the overlay empty.
  goal: {
    metric: 'follow',
    target: 0,
    current: 0,
    label: 'Follower-Ziel',
    accentColor: '#35C9A8',
    startedAt: null,
    // Which stream this count belongs to, so restarting SYNSA mid-stream
    // doesn't look like a fresh offline -> live transition. See
    // applyStreamStatus().
    streamStartedAt: null,
  },
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

// Which OBS Browser Sources have ever announced themselves, and when each was
// last seen. OBS shuts a Browser Source down while its scene is hidden, so
// "not connected right now" says nothing about whether the source exists at
// all — a remembered timestamp is what tells a hidden scene apart from one
// that was never set up. In memory only: this is diagnostics, not
// configuration, and a fresh process has every source reconnect within
// seconds anyway.
const OVERLAY_ROLES = {
  overlay: 'alert',
  'overlay-music': 'music',
  'overlay-countdown': 'countdown',
  'overlay-goal': 'goal',
};

const overlayPresence = new Map(
  Object.values(OVERLAY_ROLES).map((key) => [key, { instances: new Map(), lastSeenAt: null }])
);

function primaryOverlay() {
  return overlayClients.values().next().value || null;
}

function describeOverlayPresence(key) {
  const presence = overlayPresence.get(key);
  const primary = primaryOverlay();
  const instances = [...presence.instances].map(([client, meta]) => ({
    id: meta.id,
    connectedAt: meta.connectedAt,
    // Only the alert overlay has a primary/secondary split (see
    // sendOverlayRoles); for the other two the question doesn't apply.
    primary: key === 'alert' ? client === primary : null,
  }));

  return {
    connected: instances.length > 0,
    count: instances.length,
    lastSeenAt: instances.length > 0 ? Date.now() : presence.lastSeenAt,
    instances,
  };
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

    // Any overlay announcing itself. All three record their presence so the
    // diagnostics page can say whether they are set up in OBS at all; only
    // the alert overlay additionally gets a primary/secondary role and, if it
    // is the primary, everything that was missed while no overlay was
    // listening.
    if (msg.kind === 'register' && OVERLAY_ROLES[msg.role]) {
      const presence = overlayPresence.get(OVERLAY_ROLES[msg.role]);
      presence.instances.set(ws, { id: crypto.randomUUID().slice(0, 8), connectedAt: Date.now() });
      presence.lastSeenAt = Date.now();
    }

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
      applyStreamStatus(msg.status);
    }

    // Test hook in the same family: writes the confirmation line a successful
    // timeout/ban produces, without needing a real viewer to moderate. Calls
    // the very function the success path calls, so it exercises the real
    // behaviour rather than a parallel one.
    if (msg.kind === 'trigger-moderation-notice') {
      recordModerationNotice(msg.username || 'TestUser', msg.duration);
    }

    // Test hook mirroring the ones above: puts the Twitch connection into the
    // "this authorization is gone" state without needing a real revocation on
    // Twitch's side, and takes it back out again with { revoked: false }.
    // Goes through the exact same eventsub functions a real revocation uses,
    // so it exercises the real behaviour rather than a parallel one — including
    // that the stored tokens are left alone.
    if (msg.kind === 'trigger-auth-revoked') {
      if (msg.revoked === false) eventsub.clearAuthRevoked();
      else eventsub.markAuthRevoked('simulated');
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
        // The name comes along from the chat row the action was started from,
        // so confirming it needs no extra Helix lookup.
        const username =
          typeof msg.username === 'string' && msg.username.trim() ? msg.username.trim().slice(0, 60) : msg.userId;
        helix
          .banUser(broadcasterId, broadcasterId, { userId: msg.userId, duration: msg.duration })
          .then(() => recordModerationNotice(username, msg.duration))
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

    // The moment it goes away is exactly the "last seen" the diagnostics
    // page needs — an OBS scene switch lands here.
    for (const presence of overlayPresence.values()) {
      if (presence.instances.delete(ws)) presence.lastSeenAt = Date.now();
    }
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

  countTowardsGoal(alert);
}

// How much one alert is worth for each metric. Returns 0 for anything the
// current metric doesn't count.
function goalIncrementFor(alert) {
  const data = alert.data || {};

  if (state.goal.metric === 'follow') return alert.type === 'follow' ? 1 : 0;
  if (state.goal.metric === 'bits') return alert.type === 'cheer' ? Number(data.bits) || 0 : 0;
  if (alert.type !== 'subscription') return 0;

  // A gift bomb is worth as many subs as it gifted — a goal of "20 new subs"
  // that a single 20-gift bomb didn't move would read as broken. giftCount is
  // absent on older/edge payloads, so a gift with no count is worth one.
  const gifted = Number(data.giftCount) || 1;
  if (state.goal.metric === 'giftsub') return data.isGift ? gifted : 0;
  return data.isGift ? gifted : 1;
}

// Rides on the path every alert already takes, so there is no second source
// of events to keep in sync — and the existing trigger-alert test hook
// exercises it exactly like a real Twitch event does.
function countTowardsGoal(alert) {
  if (!(state.goal.target > 0)) return;

  const increment = goalIncrementFor(alert);
  if (!increment) return;

  state.goal = { ...state.goal, current: state.goal.current + increment };
  saveGoal();
  broadcast({ kind: 'goal-status', status: state.goal });
}

function resetGoal(streamStartedAt = state.goal.streamStartedAt) {
  state.goal = { ...state.goal, current: 0, startedAt: Date.now(), streamStartedAt };
  saveGoal();
  broadcast({ kind: 'goal-status', status: state.goal });
}

// The one place a stream going live or offline lands. Both the real EventSub
// stream.online/offline events and the trigger-stream test hook go through
// here, so the goal's automatic reset can't end up wired to only one of them.
function applyStreamStatus(status) {
  const wasLive = state.stream.live;
  state.stream = { ...state.stream, ...status };
  broadcast({ kind: 'stream-status', status: state.stream });
  // A ready-and-waiting update must immediately reflect the stream lock the
  // instant it changes, not just at the moment it was downloaded.
  update.notifyStreamChanged();

  if (wasLive || !state.stream.live) return;

  // Offline -> live starts a fresh count. Compared against the stream's own
  // start time first: EventSub reports an already-running stream again when
  // SYNSA boots, which is indistinguishable from a real transition here and
  // would otherwise throw away a count mid-stream.
  const startedAt = state.stream.startedAt || null;
  if (!startedAt || startedAt !== state.goal.streamStartedAt) {
    resetGoal(startedAt);
  }
}

function recordChatMessage(message) {
  pushChatHistory(message);
  broadcast({ kind: 'chat-message', message });
}

// Seconds into the wording the moderation menu itself uses, so the line in
// the chat log reads like the button that produced it.
function formatTimeoutDuration(seconds) {
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total <= 0) return null;
  if (total < 60) return total === 1 ? '1 Sekunde' : `${total} Sekunden`;
  if (total % 3600 === 0) {
    const hours = total / 3600;
    return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
  }
  if (total % 60 === 0) {
    const minutes = total / 60;
    return minutes === 1 ? '1 Minute' : `${minutes} Minuten`;
  }
  return `${total} Sekunden`;
}

// A timeout or ban that Twitch actually accepted, written into the chat log
// as its own line. Deliberately only on success: a failed attempt keeps the
// existing moderation-error path back to the client that asked for it, and
// must not leave a line claiming something happened that didn't.
//
// Goes through recordChatMessage() like any other line, so it lands in the
// same history, reaches every client on the same broadcast, and carries the
// same timestamp field the renderer already formats. `system: true` is what
// keeps it from being drawn as a real chat message.
function recordModerationNotice(username, durationSeconds) {
  const duration = formatTimeoutDuration(durationSeconds);
  recordChatMessage({
    id: crypto.randomUUID(),
    system: true,
    // The parts, so the dashboard can phrase this in the interface language
    // instead of being stuck with the German composed below.
    moderation: {
      action: duration ? 'timeout' : 'ban',
      username,
      durationSeconds: duration ? Math.round(Number(durationSeconds)) : null,
    },
    text: duration ? `${username} wurde für ${duration} stumm geschaltet.` : `${username} wurde gebannt.`,
    timestamp: Date.now(),
  });
}

// Once the user approves in their browser, the device flow finishes the same
// way the old OAuth callback did: bring Twitch up right away rather than
// waiting for the next restart.
deviceAuth.init({
  onConnected: () => eventsub.start(),
});

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
  onStream: (status) => applyStreamStatus(status),
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
// Both sources report through the same callback, so state.music never learns
// which one filled it. applyMusicSource() guarantees only one of them is
// running at a time.
spotify.init({ onStatus: applyMusicStatus });

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

// The authorization code flow (and with it the OAuth state bookkeeping that
// protected its redirect) is gone: SYNSA links a Twitch account through the
// device code flow now, which never redirects back and therefore has no
// state parameter to guard. See twitch/deviceAuth.js.

// Single source of truth for the version shown in the UI (module menu,
// window title) — reads package.json rather than duplicating the number.
app.get('/api/version', (req, res) => {
  res.json({ version: require('./package.json').version });
});

// --- Window close behavior ---------------------------------------------------

// What the window's X button does, shared with electron/main.js through this
// one small file — the same shape as countdown.json/music-settings.json.
// Deliberately read from disk on every request instead of cached in `state`:
// the Electron main process writes this file too (when the close dialog's
// "remember" box is ticked), so a cached copy here would go stale the moment
// the user answered that dialog.
const WINDOW_SETTINGS_FILE = path.join(DATA_DIR, 'window-settings.json');
const CLOSE_BEHAVIORS = new Set(['ask', 'tray', 'quit']);

app.get('/api/close-behavior', (req, res) => {
  let closeBehavior = 'ask';
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_SETTINGS_FILE, 'utf8'));
    if (CLOSE_BEHAVIORS.has(saved.closeBehavior)) closeBehavior = saved.closeBehavior;
  } catch {
    // Nothing saved yet — asking is the default.
  }
  res.json({ closeBehavior });
});

app.post('/api/close-behavior', (req, res) => {
  if (!CLOSE_BEHAVIORS.has(req.body.closeBehavior)) {
    res.status(400).json({ error: 'Unbekannte Einstellung' });
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WINDOW_SETTINGS_FILE, JSON.stringify({ closeBehavior: req.body.closeBehavior }));
  } catch (err) {
    console.error('Could not save window close behavior:', err.message);
    res.status(500).json({ error: 'Konnte nicht gespeichert werden' });
    return;
  }
  res.json({ ok: true });
});

// The presence of one single overlay, for the header on its own settings
// page. Same describeOverlayPresence() the diagnostics route uses — a
// settings page has no business pulling the whole diagnostics payload
// (Twitch, music, update state) every few seconds just to learn whether its
// own Browser Source is connected.
app.get('/api/overlay-status/:role', (req, res) => {
  if (!overlayPresence.has(req.params.role)) {
    res.status(404).json({ error: 'Unbekanntes Overlay' });
    return;
  }
  res.json(describeOverlayPresence(req.params.role));
});

// --- Diagnostics ------------------------------------------------------------

// One read-only snapshot of everything that can plausibly be wrong, so a user
// can see it themselves (or screenshot it for support) instead of describing
// symptoms. Deliberately has no controls of its own: it only reads state that
// already exists elsewhere, and changes nothing.
app.get('/api/diagnostics', (req, res) => {
  const twitch = state.twitch || {};
  const twitchConnected = Boolean(twitch.connected);
  const failedTypes = new Map(((twitch.subscriptions || {}).failed || []).map((f) => [f.type, f.message]));
  const updateState = update.getState();

  res.json({
    generatedAt: Date.now(),
    version: require('./package.json').version,
    server: { port: PORT, ...listenState },
    twitch: {
      connected: twitchConnected,
      channel: twitch.channel || null,
      reauthRequired: twitch.reauthRequired || null,
      subscriptions: eventsub.getSubscriptionTypes().map((type) => ({
        type,
        // null rather than false while disconnected: with no session there
        // are no subscriptions at all, so "failed" would be a lie.
        ok: twitchConnected ? !failedTypes.has(type) : null,
        message: failedTypes.get(type) || null,
      })),
    },
    overlays: {
      alert: describeOverlayPresence('alert'),
      music: describeOverlayPresence('music'),
      countdown: describeOverlayPresence('countdown'),
      goal: describeOverlayPresence('goal'),
    },
    music: { paired: Boolean(musicTokenStore.load()), connected: music.isConnected() },
    update: {
      phase: updateState.phase,
      currentVersion: updateState.currentVersion,
      availableVersion: updateState.release ? updateState.release.version : null,
    },
  });
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
// shows — so there is no second changelog file to keep in sync. Which
// repository that is comes from update/repository.js, shared with the update
// provider (and explicitly not from package.json's build block, which
// electron-builder removes when packaging).
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

  try {
    const { owner, repo } = updateRepository;
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

// --- First-run setup (linking the Twitch account) --------------------------

// What the setup screen needs to know: whether an account is linked, and
// whether SYNSA can start a device flow at all. No credentials are entered
// here anymore — see twitch/deviceAuth.js for why that step disappeared.
app.get('/api/setup/status', (req, res) => {
  res.json({
    connected: Boolean(tokenStore.load()),
    hasClientId: twitchConfig.hasClientId,
    scopes: twitchConfig.scopes,
  });
});

// Starts the device flow: answers with the short code and the Twitch page
// the user has to open. The polling itself runs in twitch/deviceAuth.js, so
// the connection still completes if this page is closed in the meantime.
app.post('/api/twitch/device/start', async (req, res) => {
  try {
    res.json(await deviceAuth.start());
  } catch (err) {
    console.error('Could not start the Twitch device flow:', err.message);
    res.status(502).json({ status: 'error', error: 'Twitch ist gerade nicht erreichbar.' });
  }
});

app.get('/api/twitch/device/status', (req, res) => {
  res.json(deviceAuth.getState());
});

app.post('/api/twitch/device/cancel', (req, res) => {
  res.json(deviceAuth.cancel());
});

// Anything still pointing at the old login route (a bookmark, an older page
// kept open) lands on the setup screen, which is where linking an account
// happens now.
app.get('/auth/twitch/login', (req, res) => {
  res.redirect('/setup.html');
});

app.post('/auth/twitch/logout', (req, res) => {
  // Also drops a device flow that may still be waiting for approval —
  // otherwise it could reconnect the account moments after disconnecting it.
  deviceAuth.cancel();
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

// --- Music sources (YTMDesktop / Spotify) ------------------------------------

// Two sources, one active at a time. Both fill state.music in the exact same
// shape, so overlay-music.html knows nothing about where a track came from —
// switching source changes which module is running, nothing else.
//
// Kept side by side rather than replacing YTMDesktop: an existing pairing
// keeps working, and neither source is obviously the right one for everybody.
const MUSIC_SOURCES = new Set(['ytmdesktop', 'spotify']);
const MUSIC_SOURCE_FILE = path.join(DATA_DIR, 'music-source.json');

function loadMusicSource() {
  try {
    const saved = JSON.parse(fs.readFileSync(MUSIC_SOURCE_FILE, 'utf8'));
    return MUSIC_SOURCES.has(saved.source) ? saved.source : 'ytmdesktop';
  } catch {
    return 'ytmdesktop';
  }
}

function saveMusicSource() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MUSIC_SOURCE_FILE, JSON.stringify({ source: musicSource }));
  } catch (err) {
    console.error('Could not save music source:', err.message);
  }
}

let musicSource = loadMusicSource();

// Stops whichever source was running and starts the selected one. Clearing
// the status in between matters: otherwise the card would keep showing the
// last track of the source that was just switched away from.
function applyMusicSource() {
  if (musicSource === 'spotify') {
    music.stop();
    spotify.start();
  } else {
    spotify.stop();
    if (musicTokenStore.load()) music.start();
  }
}

function musicStatusPayload() {
  return {
    source: musicSource,
    spotifyAvailable: spotifyConfig.hasClientId,
    ytmdesktop: { paired: Boolean(musicTokenStore.load()), connected: music.isConnected() },
    spotify: { paired: spotify.isPaired(), connected: spotify.isConnected() },
    // The active source, flattened — what the settings page and the
    // diagnostics route already read.
    paired: musicSource === 'spotify' ? spotify.isPaired() : Boolean(musicTokenStore.load()),
    connected: musicSource === 'spotify' ? spotify.isConnected() : music.isConnected(),
  };
}

app.get('/api/music/status', (req, res) => {
  res.json(musicStatusPayload());
});

app.post('/api/music/source', (req, res) => {
  if (!MUSIC_SOURCES.has(req.body.source)) {
    res.status(400).json({ error: 'Unbekannte Musikquelle' });
    return;
  }
  if (req.body.source === 'spotify' && !spotifyConfig.hasClientId) {
    res.status(409).json({ error: 'Für Spotify ist keine Client-ID konfiguriert' });
    return;
  }

  musicSource = req.body.source;
  saveMusicSource();
  applyMusicStatus({ ...state.music, connected: false, title: null });
  applyMusicSource();
  res.json({ ok: true, source: musicSource });
});

// --- Spotify ------------------------------------------------------------------

// The browser only ever asks for the URL; opening it is the tray app's job
// (shell.openExternal), exactly like the Twitch device flow. A page inside
// SYNSA must not navigate itself to Spotify — the callback has to come back
// to this loopback server, not into the app window.
app.get('/api/spotify/authorize-url', (req, res) => {
  if (!spotifyConfig.hasClientId) {
    res.status(409).json({ error: 'Für Spotify ist keine Client-ID konfiguriert' });
    return;
  }
  res.json({ url: spotifyAuth.buildAuthorizeUrl() });
});

// Where Spotify sends the browser back to. Registered in the Spotify
// dashboard as http://127.0.0.1:<port>/spotify/callback — "localhost" is
// rejected there, loopback IP literals are not.
app.get('/spotify/callback', async (req, res) => {
  if (req.query.error) {
    spotifyAuth.cancel();
    res.status(400).send(`Spotify-Anmeldung abgebrochen: ${req.query.error}`);
    return;
  }

  try {
    await spotifyAuth.exchangeCode(String(req.query.code || ''), String(req.query.state || ''));
    musicSource = 'spotify';
    saveMusicSource();
    applyMusicSource();
    broadcast({ kind: 'music-source', status: musicStatusPayload() });
    // A plain confirmation page, not a redirect into SYNSA's own UI: this
    // runs in the *system* browser, and opening a second copy of the app
    // there would be more confusing than helpful. The settings page inside
    // SYNSA has already updated itself via the broadcast above.
    res.type('html').send(
      '<!doctype html><meta charset="utf-8"><title>SYNSA</title>' +
        '<body style="font-family:system-ui,sans-serif;background:#0b0d0d;color:#F1F5F3;padding:48px;">' +
        '<h1 style="font-size:20px;">Spotify ist verbunden.</h1>' +
        '<p style="color:#9fb0ab;">Du kannst dieses Fenster schließen und zu SYNSA zurückkehren.</p>'
    );
  } catch (err) {
    console.error('Spotify authorization failed:', err.message);
    res.status(500).send('Spotify-Anmeldung fehlgeschlagen. Du kannst das Fenster schließen und es erneut versuchen.');
  }
});

app.post('/api/spotify/disconnect', (req, res) => {
  spotify.stop();
  spotifyTokenStore.clear();
  res.json({ ok: true });
});

// --- YTMDesktop ---------------------------------------------------------------

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

  // An empty label is a value, not a missing one: clearing the field and
  // pressing Start is how you ask for a countdown with no caption.
  //
  // This used to fall back to the stored label, because reloading the
  // settings page mid-run left the field blank and Start would then have
  // wiped it. That reason is gone: countdown-settings.js's applyCountdown()
  // mirrors the server's label into the field on every status it receives,
  // running or not, so a blank field now only ever means the user blanked it.
  //
  // A request that omits the field entirely still keeps the stored label —
  // that is a malformed call, not somebody clearing a field.
  const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 60) : state.countdown.label;
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

// --- Stream goal -------------------------------------------------------------

// Same load/save shape as the countdown above. The running count is part of
// what's saved, not just the settings: a goal is supposed to survive a
// restart mid-stream — the only thing that clears it is a new stream going
// live or the reset button.
const GOAL_FILE = path.join(DATA_DIR, 'goal.json');

function loadGoal() {
  try {
    const saved = JSON.parse(fs.readFileSync(GOAL_FILE, 'utf8'));
    return {
      ...state.goal,
      ...saved,
      // Guards against a hand-edited or half-written file turning the
      // overlay into NaN of NaN.
      target: Number(saved.target) || 0,
      current: Number(saved.current) || 0,
      metric: GOAL_METRICS.has(saved.metric) ? saved.metric : state.goal.metric,
    };
  } catch {
    return state.goal;
  }
}

function saveGoal() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(GOAL_FILE, JSON.stringify(state.goal));
  } catch (err) {
    console.error('Could not save goal:', err.message);
  }
}

// Deliberately SYNSA's own metrics rather than Twitch's Creator Goals: bits
// and gift subs have no channel.goal.* equivalent at all, and everything here
// is derived from alerts SYNSA already receives — no extra scope, no extra
// subscription.
const GOAL_METRICS = new Set(['follow', 'subscription', 'giftsub', 'bits']);
const MAX_GOAL_TARGET = 10000000;

state.goal = loadGoal();

app.get('/api/goal/status', (req, res) => {
  res.json(state.goal);
});

app.post('/api/goal/settings', (req, res) => {
  const target = Math.round(Number(req.body.target));
  if (!Number.isFinite(target) || target < 1 || target > MAX_GOAL_TARGET) {
    res.status(400).json({ error: 'Ungültiger Zielwert' });
    return;
  }
  if (!GOAL_METRICS.has(req.body.metric)) {
    res.status(400).json({ error: 'Unbekannte Metrik' });
    return;
  }

  // Same reasoning as the countdown's label handling: an empty field keeps
  // the stored value instead of wiping it.
  const trimmedLabel = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 60) : '';
  const accentColor = HEX_COLOR_RE.test(req.body.accentColor) ? req.body.accentColor : state.goal.accentColor;

  // Switching metric starts over — bits counted into a follower goal would be
  // nonsense. Raising or lowering the target of the same metric keeps the
  // count, which is the whole point of being able to adjust it mid-stream.
  const metricChanged = req.body.metric !== state.goal.metric;

  state.goal = {
    ...state.goal,
    metric: req.body.metric,
    target,
    label: trimmedLabel || state.goal.label,
    accentColor,
    current: metricChanged ? 0 : state.goal.current,
    startedAt: metricChanged || state.goal.startedAt === null ? Date.now() : state.goal.startedAt,
  };
  saveGoal();
  broadcast({ kind: 'goal-status', status: state.goal });
  res.json({ ok: true });
});

// Manual reset, for a goal that is meant to run across several streams and
// should restart on the streamer's word rather than on the next stream.online.
app.post('/api/goal/reset', (req, res) => {
  resetGoal();
  res.json({ ok: true });
});

// Filled in by the boot sequence below once the listeners are up.
let listenState = { startedAt: null, boundHosts: [], failedHosts: [] };

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

  // Kept for /api/diagnostics: "localhost" resolves to ::1 first on Windows,
  // so a source that cannot reach SYNSA while another one can is almost
  // always a half-bound port — worth being able to see rather than guess.
  listenState = {
    startedAt: Date.now(),
    boundHosts: bound.map((r) => r.value),
    failedHosts: results
      .filter((r) => r.status === 'rejected')
      .map((r) => ({ host: r.reason.host, message: r.reason.message })),
  };

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

  try {
    applyMusicSource();
  } catch (err) {
    console.error('Could not start the music source on boot:', err.message);
  }
})();

module.exports = { ready, port: PORT };
