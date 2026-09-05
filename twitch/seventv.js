// Resolves 7TV emotes (global + the channel's connected set). Exposes both
// a flat name -> URL map (for replacing emote names in chat text) and the
// two sets separately (for the emote picker, grouped by source).
// Twitch's own emotes are handled separately via EventSub message
// fragments (see mapChat.js) and the emote picker (see helix.getUserEmotes).

let flatMap = new Map();
let channelEmotes = [];
let globalEmotes = [];
// toObject() is called on every connection status change and its result is
// broadcast to every client. Rebuilding a thousand-entry object each time
// is pointless when it only ever changes on refresh().
let flatObjectCache = null;

async function refresh(twitchUserId) {
  const newFlat = new Map();
  let newGlobal = [];
  let newChannel = [];

  try {
    const res = await fetch('https://7tv.io/v3/emote-sets/global');
    if (res.ok) {
      const globalSet = await res.json();
      newGlobal = toEmoteList(globalSet.emotes);
      addToMap(newFlat, newGlobal);
    }
  } catch (err) {
    console.error('7TV global emote fetch failed:', err.message);
  }

  try {
    const res = await fetch(`https://7tv.io/v3/users/twitch/${twitchUserId}`);
    if (res.ok) {
      const userData = await res.json();
      if (userData.emote_set && userData.emote_set.emotes) {
        newChannel = toEmoteList(userData.emote_set.emotes);
        addToMap(newFlat, newChannel);
      }
    }
  } catch (err) {
    console.error('7TV channel emote fetch failed:', err.message);
  }

  flatMap = newFlat;
  globalEmotes = newGlobal;
  channelEmotes = newChannel;
  flatObjectCache = null;
}

function toEmoteList(emotes) {
  return (emotes || []).map((emote) => ({
    name: emote.name,
    url: `https://cdn.7tv.app/emote/${emote.id}/2x.webp`,
  }));
}

function addToMap(map, list) {
  for (const emote of list) {
    map.set(emote.name, emote.url);
  }
}

function toObject() {
  if (!flatObjectCache) flatObjectCache = Object.fromEntries(flatMap);
  return flatObjectCache;
}

function getGrouped() {
  return { channel: channelEmotes, global: globalEmotes };
}

module.exports = { refresh, toObject, getGrouped };
