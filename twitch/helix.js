const config = require('./config');
const tokenStore = require('./tokenStore');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX_URL = 'https://api.twitch.tv/helix';

async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });

  const res = await fetch(TOKEN_URL, { method: 'POST', body: params });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, { method: 'POST', body: params });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Twitch refresh tokens are single-use: the first refresh invalidates the
// old one. Several Helix calls run in parallel (the chatters view fires
// four at once), so without this they would all hit 401 together, all
// refresh with the same now-spent token, and all but one would fail.
// Sharing one in-flight refresh means everybody waits for the same result.
let refreshInFlight = null;

function refreshTokens(currentRefreshToken) {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(currentRefreshToken)
      .then((refreshed) => {
        const tokens = {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
        };
        tokenStore.save(tokens);
        return tokens;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

// Calls a Helix endpoint with the stored access token, transparently
// refreshing and retrying once if Twitch says the token expired.
async function helixFetch(pathAndQuery, options = {}) {
  const tokens = tokenStore.load();
  if (!tokens) throw new Error('Not authenticated with Twitch yet');

  const doFetch = (accessToken) =>
    fetch(`${HELIX_URL}${pathAndQuery}`, {
      ...options,
      headers: {
        ...options.headers,
        'Client-Id': config.clientId,
        Authorization: `Bearer ${accessToken}`,
      },
    });

  let res = await doFetch(tokens.accessToken);

  if (res.status === 401) {
    const refreshed = await refreshTokens(tokens.refreshToken);
    res = await doFetch(refreshed.accessToken);
  }

  return res;
}

async function getSelfUser() {
  const res = await helixFetch('/users');
  if (!res.ok) {
    throw new Error(`Get user failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data[0];
}

async function sendChatMessage(broadcasterId, senderId, message) {
  const res = await helixFetch('/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ broadcaster_id: broadcasterId, sender_id: senderId, message }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Send chat message failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// duration in seconds -> timeout; omitted -> permanent ban.
async function banUser(broadcasterId, moderatorId, { userId, duration, reason }) {
  const payload = { user_id: userId };
  if (duration) payload.duration = duration;
  if (reason) payload.reason = reason;

  const res = await helixFetch(`/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: payload }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Ban/timeout failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// Empty data array means offline. Used both on boot (to catch a stream that
// was already live before the app started) and as the source of truth for
// the exact started_at timestamp.
async function getStreamInfo(userId) {
  const res = await helixFetch(`/streams?user_id=${userId}`);
  if (!res.ok) {
    throw new Error(`Get stream info failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data[0] || null;
}

async function getChannelInfo(broadcasterId) {
  const res = await helixFetch(`/channels?broadcaster_id=${broadcasterId}`);
  if (!res.ok) {
    throw new Error(`Get channel info failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data[0];
}

async function updateChannelInfo(broadcasterId, { title, gameId }) {
  const payload = {};
  if (typeof title === 'string') payload.title = title;
  if (typeof gameId === 'string' && gameId) payload.game_id = gameId;

  const res = await helixFetch(`/channels?broadcaster_id=${broadcasterId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Update channel info failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

async function searchCategories(query) {
  const res = await helixFetch(`/search/categories?query=${encodeURIComponent(query)}&first=8`);
  if (!res.ok) {
    throw new Error(`Search categories failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data;
}

// Everyone currently connected to the channel's chat. Paginated (up to
// 1000 per page), so we follow the cursor to get an accurate total.
async function getChatters(broadcasterId, moderatorId) {
  const chatters = [];
  let total = 0;
  let cursor = '';

  do {
    const query = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
    const res = await helixFetch(
      `/chat/chatters?broadcaster_id=${broadcasterId}&moderator_id=${moderatorId}&first=1000${query}`
    );
    if (!res.ok) {
      throw new Error(`Get chatters failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    chatters.push(...body.data);
    total = typeof body.total === 'number' ? body.total : total;
    cursor = (body.pagination && body.pagination.cursor) || '';
  } while (cursor);

  return { chatters, total };
}

async function getModerators(broadcasterId) {
  const moderators = [];
  let cursor = '';

  do {
    const query = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
    const res = await helixFetch(`/moderation/moderators?broadcaster_id=${broadcasterId}&first=100${query}`);
    if (!res.ok) {
      throw new Error(`Get moderators failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    moderators.push(...body.data);
    cursor = (body.pagination && body.pagination.cursor) || '';
  } while (cursor);

  return moderators;
}

async function getVips(broadcasterId) {
  const vips = [];
  let cursor = '';

  do {
    const query = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
    const res = await helixFetch(`/channels/vips?broadcaster_id=${broadcasterId}&first=100${query}`);
    if (!res.ok) {
      throw new Error(`Get VIPs failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    vips.push(...body.data);
    cursor = (body.pagination && body.pagination.cursor) || '';
  } while (cursor);

  return vips;
}

async function getSubscribers(broadcasterId) {
  const subscribers = [];
  let cursor = '';

  do {
    const query = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
    const res = await helixFetch(`/subscriptions?broadcaster_id=${broadcasterId}&first=100${query}`);
    if (!res.ok) {
      throw new Error(`Get subscribers failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    subscribers.push(...body.data);
    cursor = (body.pagination && body.pagination.cursor) || '';
  } while (cursor);

  return subscribers;
}

// Every emote the user can use: Twitch globals, their own channel's
// subscriber emotes, and subscriber emotes from every other channel
// they're subscribed to. Paginated, so we follow the cursor.
async function getUserEmotes(userId) {
  const emotes = [];
  let template = '';
  let cursor = '';

  do {
    const query = cursor ? `&after=${encodeURIComponent(cursor)}` : '';
    const res = await helixFetch(`/chat/emotes/user?user_id=${userId}${query}`);
    if (!res.ok) {
      throw new Error(`Get user emotes failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    emotes.push(...body.data);
    template = body.template || template;
    cursor = (body.pagination && body.pagination.cursor) || '';
  } while (cursor);

  return { emotes, template };
}

// Resolves user ids to display names, batching up to 100 per request (the
// Helix limit) — used to label each Twitch emote group by channel name.
async function getUsersByIds(ids) {
  // Twitch user IDs are always plain numeric strings — filtering to that
  // shape guards against a stray malformed/empty owner_id blowing up the
  // whole batch with a 400.
  const unique = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
  const users = [];

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const query = batch.map((id) => `id=${encodeURIComponent(id)}`).join('&');
    const res = await helixFetch(`/users?${query}`);
    if (!res.ok) {
      throw new Error(`Get users failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    users.push(...body.data);
  }

  return users;
}

async function createEventSubSubscription(type, version, condition, sessionId) {
  const res = await helixFetch('/eventsub/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      version,
      condition,
      transport: { method: 'websocket', session_id: sessionId },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Subscribe to ${type} failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// Every reconnect leaves its old subscriptions behind in
// websocket_disconnected state. Twitch drops them on its own after about an
// hour, but they count against the account in the meantime and pile up fast
// during a restart-heavy session.
async function deleteDisconnectedSubscriptions() {
  let cursor = '';
  const ids = [];

  do {
    const query = cursor ? `?status=websocket_disconnected&after=${encodeURIComponent(cursor)}` : '?status=websocket_disconnected';
    const res = await helixFetch(`/eventsub/subscriptions${query}`);
    if (!res.ok) {
      throw new Error(`List subscriptions failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    ids.push(...body.data.map((s) => s.id));
    cursor = (body.pagination && body.pagination.cursor) || '';
  } while (cursor);

  for (const id of ids) {
    await helixFetch(`/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }

  return ids.length;
}

module.exports = {
  exchangeCode,
  deleteDisconnectedSubscriptions,
  refreshAccessToken,
  helixFetch,
  getSelfUser,
  getStreamInfo,
  createEventSubSubscription,
  sendChatMessage,
  getChannelInfo,
  updateChannelInfo,
  searchCategories,
  getUserEmotes,
  getUsersByIds,
  banUser,
  getChatters,
  getModerators,
  getVips,
  getSubscribers,
};
