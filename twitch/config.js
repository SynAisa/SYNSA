require('dotenv').config();

const { getCredentials } = require('./appConfig');

const PORT = process.env.PORT || 4242;

// clientId/clientSecret are getters on purpose: they can be entered at
// runtime through the setup page, and every call site should see the new
// values without needing a restart.
module.exports = {
  get clientId() {
    return getCredentials().clientId;
  },
  get clientSecret() {
    return getCredentials().clientSecret;
  },
  redirectUri: process.env.TWITCH_REDIRECT_URI || `http://localhost:${PORT}/auth/twitch/callback`,
  // moderator:read:followers -> channel.follow
  // channel:read:subscriptions -> channel.subscribe / .gift / .message
  // bits:read -> channel.cheer
  // user:read:chat -> channel.chat.message
  // user:write:chat -> sending chat messages
  // channel:manage:broadcast -> editing title/category
  // user:read:emotes -> emote picker (your emotes + subscribed channels')
  // moderator:manage:banned_users -> timeout / ban from the dashboard
  // moderator:read:chatters -> who's currently in chat
  // moderation:read -> moderator list, for the chatters list
  // channel:read:vips -> VIP list, for the chatters list
  scopes: [
    'moderator:read:followers',
    'channel:read:subscriptions',
    'bits:read',
    'user:read:chat',
    'user:write:chat',
    'channel:manage:broadcast',
    'user:read:emotes',
    'moderator:manage:banned_users',
    'moderator:read:chatters',
    'moderation:read',
    'channel:read:vips',
  ],
};
