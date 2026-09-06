const WebSocket = require('ws');
const helix = require('./helix');
const tokenStore = require('./tokenStore');
const seventv = require('./seventv');
const { isAuthorizationRevoked } = require('./revocation');
const { mapEventSubNotification } = require('./mapEvents');
const { mapChatMessage } = require('./mapChat');

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws';

const SUBSCRIPTIONS = [
  // Twitch's own exception to the channel.* naming scheme — these two are
  // just "stream.online" / "stream.offline", confirmed by "invalid
  // subscription type and version" from the channel.-prefixed attempt.
  { type: 'stream.online', version: '1', condition: (b) => ({ broadcaster_user_id: b.id }) },
  { type: 'stream.offline', version: '1', condition: (b) => ({ broadcaster_user_id: b.id }) },
  { type: 'channel.follow', version: '2', condition: (b) => ({ broadcaster_user_id: b.id, moderator_user_id: b.id }) },
  { type: 'channel.subscribe', version: '1', condition: (b) => ({ broadcaster_user_id: b.id }) },
  { type: 'channel.subscription.gift', version: '1', condition: (b) => ({ broadcaster_user_id: b.id }) },
  { type: 'channel.subscription.message', version: '1', condition: (b) => ({ broadcaster_user_id: b.id }) },
  { type: 'channel.cheer', version: '1', condition: (b) => ({ broadcaster_user_id: b.id }) },
  { type: 'channel.raid', version: '1', condition: (b) => ({ to_broadcaster_user_id: b.id }) },
  { type: 'channel.chat.message', version: '1', condition: (b) => ({ broadcaster_user_id: b.id, user_id: b.id }) },
];

// Twitch sends a keepalive every ~10s; going quiet for much longer than
// that means the socket is dead even if TCP hasn't noticed yet (typical
// after the machine sleeps or the router hiccups). Without this watchdog
// alerts just silently stop mid-stream.
const KEEPALIVE_TIMEOUT_MS = 45000;
const WATCHDOG_INTERVAL_MS = 10000;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 60000;

let ws = null;
let broadcasterUser = null;
let hasSubscribed = false;
let currentSessionId = null;
let lastMessageAt = 0;
let watchdogTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let failedSubscriptions = [];
let stopped = true;
// null while everything is normal. Set to { reason, since } once Twitch has
// made clear that this authorization is gone for good — see markAuthRevoked().
// Deliberately not persisted and never used to delete tokens: it only records
// that reconnecting cannot help until the user links SYNSA again.
let reauthRequired = null;
let onAlertCallback = () => {};
let onChatCallback = () => {};
let onStatusCallback = () => {};
let onStreamCallback = () => {};

function init({ onAlert, onChat, onStatus, onStream }) {
  onAlertCallback = onAlert || (() => {});
  onChatCallback = onChat || (() => {});
  onStatusCallback = onStatus || (() => {});
  onStreamCallback = onStream || (() => {});
}

function setStreamStatus(live, startedAt) {
  onStreamCallback({ live, startedAt: live ? startedAt : null });
}

// start() is reachable from three places (boot, the OAuth callback and the
// credentials form). Two overlapping runs used to open two sockets: the
// second session won, but hasSubscribed was already true, so it subscribed
// to nothing and sat there "connected" without delivering a single event
// until Twitch dropped it. One in-flight run is shared instead.
let startInFlight = null;

function start() {
  if (!startInFlight) {
    startInFlight = runStart().finally(() => {
      startInFlight = null;
    });
  }
  return startInFlight;
}

async function runStart() {
  if (!tokenStore.load()) return;

  stopped = false;

  try {
    broadcasterUser = await helix.getSelfUser();
  } catch (err) {
    // Twitch rejected the refresh token itself (see helix.refreshAccessToken).
    // Retrying is pointless — every attempt would be rejected the same way —
    // so stop and say so instead of backing off forever in silence.
    if (err.authRevoked) {
      markAuthRevoked('refresh-rejected');
      return;
    }

    // Typically the network isn't up yet (autostart on boot). Without a
    // retry here the app stayed disconnected until it was restarted by
    // hand, because nothing had scheduled a reconnect at this point.
    // Retrying start() rather than connect(): without broadcasterUser a
    // connection comes up subscribed to nothing.
    console.error('Could not load Twitch user, retrying shortly:', err.message);
    setStatus(false);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) start();
    }, nextReconnectDelay());
    return;
  }

  // Getting this far means the token works, so whatever was wrong before is
  // over — a successful call is the only thing that clears the flag.
  clearAuthRevoked();

  await seventv.refresh(broadcasterUser.id).catch(() => {});
  hasSubscribed = false;
  connect(EVENTSUB_WS_URL);
  startWatchdog();

  // The stream may already have been live before this app started — the
  // online/offline events only fire on the next transition, so the current
  // state has to be fetched once up front instead of assumed offline.
  try {
    const stream = await helix.getStreamInfo(broadcasterUser.id);
    setStreamStatus(Boolean(stream), stream ? Date.parse(stream.started_at) : null);
  } catch (err) {
    console.error('Could not fetch current stream status:', err.message);
  }
}

// Everything stop() does to the connection, minus the parts that only make
// sense when the user deliberately disconnects. The tokens stay untouched on
// purpose (requirement: only an explicit disconnect or a fresh setup run may
// remove them) and broadcasterUser is kept so the banner can still name the
// channel. What this really buys is `stopped = true`, which is what
// scheduleReconnect() and the watchdog check before doing anything.
function markAuthRevoked(reason) {
  if (reauthRequired) return;

  console.error(`Twitch authorization is no longer valid (${reason}) — stopping reconnects until SYNSA is linked again.`);
  reauthRequired = { reason, since: Date.now() };

  stopped = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearInterval(watchdogTimer);
  watchdogTimer = null;

  const current = ws;
  // Cleared before closing so the socket's own close handler sees
  // `socket === ws` as false and does not schedule a reconnect.
  ws = null;
  hasSubscribed = false;
  currentSessionId = null;

  if (current) {
    try {
      current.close();
    } catch {
      // already closed
    }
  }

  setStatus(false);
  setStreamStatus(false, null);
}

function clearAuthRevoked() {
  if (!reauthRequired) return;
  console.log('Twitch authorization works again.');
  reauthRequired = null;
  // Only ever reached while disconnected — the flag is what kept the socket
  // from coming back — so this broadcast takes the banner down as soon as the
  // token works again, without waiting for the connection to finish coming up.
  setStatus(false);
}

function stop() {
  stopped = true;
  // A deliberate disconnect is not a state anyone needs to fix — dropping the
  // flag keeps the banner from outliving the connection it was about.
  reauthRequired = null;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearInterval(watchdogTimer);
  watchdogTimer = null;

  const current = ws;
  ws = null;
  broadcasterUser = null;
  hasSubscribed = false;
  currentSessionId = null;

  if (current) {
    try {
      current.close();
    } catch {
      // already closed
    }
  }

  setStatus(false);
  setStreamStatus(false, null);
}

// A fixed 3s retry hammered Twitch for as long as an outage lasted. Backing
// off spreads that out, while staying fast for the common case (a brief
// blip reconnects on the first try).
function nextReconnectDelay() {
  const delay = Math.min(RECONNECT_DELAY_MS * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
  reconnectAttempts += 1;
  return delay;
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!stopped) connect(EVENTSUB_WS_URL);
  }, nextReconnectDelay());
}

function startWatchdog() {
  clearInterval(watchdogTimer);
  lastMessageAt = Date.now();

  watchdogTimer = setInterval(() => {
    if (stopped || !ws) return;
    if (Date.now() - lastMessageAt <= KEEPALIVE_TIMEOUT_MS) return;

    console.warn('EventSub went quiet past the keepalive window — reconnecting.');
    const stale = ws;
    ws = null;
    hasSubscribed = false;
    setStatus(false);
    try {
      stale.terminate();
    } catch {
      // already gone
    }
    scheduleReconnect();
  }, WATCHDOG_INTERVAL_MS);
}

function connect(url) {
  const socket = new WebSocket(url);

  socket.on('message', (raw) => {
    lastMessageAt = Date.now();
    handleMessage(socket, raw).catch((err) => {
      console.error('EventSub message handling failed:', err.message);
    });
  });

  socket.on('close', () => {
    if (socket === ws) {
      ws = null;
      hasSubscribed = false;
      setStatus(false);
      scheduleReconnect();
    }
  });

  socket.on('error', () => {
    try {
      socket.close();
    } catch {
      // ignore
    }
  });
}

async function handleMessage(socket, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  const messageType = msg.metadata && msg.metadata.message_type;

  if (messageType === 'session_welcome') {
    const sessionId = msg.payload.session.id;
    currentSessionId = sessionId;
    // Back to square one for the backoff — this connection worked.
    reconnectAttempts = 0;
    console.log(`EventSub session ID (for \`twitch event trigger ... -s <id>\`): ${sessionId}`);

    const previous = ws;
    ws = socket;

    if (previous && previous !== socket) {
      try {
        previous.close();
      } catch {
        // ignore
      }
    }

    if (!hasSubscribed) {
      await subscribeAll(sessionId);
      hasSubscribed = true;

      // Housekeeping only — deliberately not awaited so a slow cleanup
      // never delays the connection that just came up.
      helix
        .deleteDisconnectedSubscriptions()
        .then((count) => {
          if (count) console.log(`Cleaned up ${count} stale EventSub subscription(s).`);
        })
        .catch((err) => console.error('EventSub cleanup failed:', err.message));
    }

    setStatus(true);
    return;
  }

  if (messageType === 'session_reconnect') {
    connect(msg.payload.session.reconnect_url);
    return;
  }

  if (messageType === 'notification') {
    const subType = msg.payload.subscription.type;
    const event = msg.payload.event;

    if (subType === 'channel.chat.message') {
      onChatCallback(mapChatMessage(event));
      return;
    }

    if (subType === 'stream.online') {
      setStreamStatus(true, Date.parse(event.started_at));
      return;
    }

    if (subType === 'stream.offline') {
      setStreamStatus(false, null);
      return;
    }

    const alert = mapEventSubNotification(subType, event);
    if (alert) onAlertCallback(alert);
    return;
  }

  if (messageType === 'revocation') {
    const status = msg.payload.subscription.status;
    console.warn('EventSub subscription revoked:', msg.payload.subscription.type, status);

    // The status field says which of the three revocation reasons this is —
    // see twitch/revocation.js. One message with authorization_revoked is
    // enough and unambiguous; user_removed and version_removed keep the normal
    // reconnect behaviour they have always had.
    if (isAuthorizationRevoked(status)) {
      markAuthRevoked('subscriptions-revoked');
    }
  }
}

async function subscribeAll(sessionId) {
  if (!broadcasterUser) {
    console.error('Cannot subscribe: no Twitch user loaded.');
    return;
  }

  const failed = [];

  for (const sub of SUBSCRIPTIONS) {
    try {
      await helix.createEventSubSubscription(sub.type, sub.version, sub.condition(broadcasterUser), sessionId);
    } catch (err) {
      console.error(`Could not subscribe to ${sub.type}:`, err.message);
      failed.push({ type: sub.type, message: err.message });
    }
  }

  failedSubscriptions = failed;
}

function setStatus(connected) {
  onStatusCallback({
    connected,
    channel: broadcasterUser ? broadcasterUser.display_name : null,
    broadcasterId: broadcasterUser ? broadcasterUser.id : null,
    sessionId: connected ? currentSessionId : null,
    // Tells "SYNSA is not connected right now" apart from "Twitch will not let
    // SYNSA back in until it is linked again". Rides along on the existing
    // twitch-status broadcast, so no page needs new plumbing to see it.
    reauthRequired,
    emotes: connected ? seventv.toObject() : {},
    // A failed subscription used to be a console line nobody would ever
    // read — which is exactly how stream.online stayed broken unnoticed.
    // Surfacing it lets the UI say "follows aren't arriving" out loud.
    subscriptions: connected
      ? { total: SUBSCRIPTIONS.length, failed: failedSubscriptions }
      : { total: SUBSCRIPTIONS.length, failed: [] },
  });
}

function isRunning() {
  return !!ws;
}

function getBroadcasterId() {
  return broadcasterUser ? broadcasterUser.id : null;
}

// The full list of types SYNSA subscribes to, so the diagnostics page can show
// every one of them with an OK/failed mark instead of only the failures that
// setStatus() reports. Exported rather than copied: one list, here.
function getSubscriptionTypes() {
  return SUBSCRIPTIONS.map((sub) => sub.type);
}

module.exports = {
  init,
  start,
  stop,
  isRunning,
  getBroadcasterId,
  getSubscriptionTypes,
  markAuthRevoked,
  clearAuthRevoked,
};
