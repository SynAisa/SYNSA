require('dotenv').config();

// Spotify application settings.
//
// Unlike Twitch, SYNSA ships no built-in client ID here. A Spotify
// application has to be registered by whoever distributes SYNSA, at
// https://developer.spotify.com/dashboard, and two things about it matter:
//
//   1. The redirect URI must be registered there *exactly* as SYNSA sends
//      it. Spotify rejects "localhost" outright but explicitly allows
//      loopback IP literals — the same trap SYNSA already knows from Twitch
//      and solves by binding 127.0.0.1 and ::1.
//   2. A newly registered app is in development mode, where only users the
//      developer adds by hand (up to 25) can authorise it. Reaching everyone
//      else needs a quota extension request to Spotify.
//
// Until a client ID is configured, the music settings page says Spotify is
// unavailable instead of starting a flow that can only fail.
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';

// Loopback IP literal, not "localhost". Must match the Spotify dashboard
// entry character for character, port included.
const PORT = process.env.PORT || 4242;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/spotify/callback`;

module.exports = {
  get clientId() {
    return CLIENT_ID;
  },

  get hasClientId() {
    return Boolean(CLIENT_ID);
  },

  redirectUri: REDIRECT_URI,

  // The minimum for a now-playing overlay:
  //   user-read-currently-playing -> what is playing
  //   user-read-playback-state    -> position, duration and play/pause
  scopes: ['user-read-currently-playing', 'user-read-playback-state'],

  authorizeUrl: 'https://accounts.spotify.com/authorize',
  tokenUrl: 'https://accounts.spotify.com/api/token',
  apiBase: 'https://api.spotify.com/v1',
};
