require('dotenv').config();

const PORT = process.env.PORT || 4242;

// SYNSA's own Twitch application, registered as a *public* client.
//
// A client ID is not a secret: it names the application, the way a package
// name does, and Twitch shows it in every authorization URL anyway. What
// used to be secret — the client *secret* — is gone entirely, because the
// device code grant flow public clients use does not need one. That is the
// whole reason this can be shipped inside the app: there is nothing here
// left to leak, and nobody has to register their own Twitch application and
// copy credentials into SYNSA anymore.
//
// Overridable through TWITCH_CLIENT_ID for development against a separate
// Twitch application.
const BUILT_IN_CLIENT_ID = '';

module.exports = {
  get clientId() {
    return process.env.TWITCH_CLIENT_ID || BUILT_IN_CLIENT_ID;
  },

  // Whether SYNSA can talk to Twitch at all. Without a client ID the device
  // flow cannot even be started, and the setup page says so instead of
  // failing with a Twitch error nobody can act on.
  get hasClientId() {
    return Boolean(this.clientId);
  },

  // Kept for the local callback URL shown in the UI and for anyone still
  // running an own Twitch application via TWITCH_CLIENT_ID; the device code
  // flow itself never redirects anywhere.
  redirectUri: process.env.TWITCH_REDIRECT_URI || `http://localhost:${PORT}/auth/twitch/callback`,

  // Every scope SYNSA asks for, and the feature it exists for. The setup
  // screen explains these to the user in the same order, so keep the two in
  // sync when changing anything here.
  //   moderator:read:followers   -> channel.follow
  //   channel:read:subscriptions -> channel.subscribe / .gift / .message
  //   bits:read                  -> channel.cheer
  //   user:read:chat             -> channel.chat.message
  //   user:write:chat            -> sending chat messages
  //   channel:manage:broadcast   -> editing title/category
  //   user:read:emotes           -> emote picker (your emotes + subscribed channels')
  //   moderator:manage:banned_users -> timeout / ban from the dashboard
  //   moderator:read:chatters    -> who's currently in chat
  //   moderation:read            -> moderator list, for the chatters list
  //   channel:read:vips          -> VIP list, for the chatters list
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
