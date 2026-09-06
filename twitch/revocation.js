// What an EventSub revocation actually means. Kept as its own pure module —
// same reasoning as update/versionCompare.js — because it is the one piece of
// this decision that can be tested without a socket, a Twitch account, or a
// real revocation happening.
//
// Twitch sends a revocation message per subscription, and the subscription
// object carries a status field with exactly one of three values:
//
//   authorization_revoked  the user withdrew SYNSA's access (removed it from
//                          their Twitch connections, changed their password).
//                          Reconnecting cannot fix this.
//   user_removed           the referenced user no longer exists.
//   version_removed        the subscribed type/version is no longer supported
//                          — e.g. Twitch retiring Hype Train v1 in January
//                          2026. Nothing to do with authorization.
//
// Only the first one means SYNSA has to be linked again. The other two must
// not take the connection down: a retired subscription version is Twitch's
// housekeeping, not a broken account link.
const AUTHORIZATION_REVOKED = 'authorization_revoked';

// Anything that is not exactly authorization_revoked returns false, including
// an unknown value, a missing status, or a status Twitch might add later.
// Deliberately conservative: falsely stopping every reconnect would silently
// take alerts and chat off the stream, while falsely continuing to reconnect
// costs nothing but a few retries.
function isAuthorizationRevoked(status) {
  return status === AUTHORIZATION_REVOKED;
}

module.exports = { AUTHORIZATION_REVOKED, isAuthorizationRevoked };
