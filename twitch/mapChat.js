// Translates a raw `channel.chat.message` EventSub event into the shape
// the dashboard renders. Twitch's own emotes are already identified via
// message.fragments (fragment.emote.id -> CDN image); 7TV emotes are
// resolved client-side against the name -> URL map from twitch/seventv.js.
function mapChatMessage(event) {
  return {
    id: event.message_id,
    userId: event.chatter_user_id,
    username: event.chatter_user_name,
    color: event.color || null,
    badges: (event.badges || []).map((b) => ({ setId: b.set_id, id: b.id, info: b.info || '' })),
    fragments: (event.message.fragments || []).map((f) => ({
      type: f.type,
      text: f.text,
      emoteId: f.type === 'emote' && f.emote ? f.emote.id : null,
    })),
    timestamp: Date.now(),
  };
}

module.exports = { mapChatMessage };
