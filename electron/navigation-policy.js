// The renderer may only stay inside SYNSA for this exact loopback origin.
// A prefix comparison accepts lookalikes such as localhost:4242.evil.test.
function isInternalAppUrl(value, baseUrl) {
  try {
    return new URL(value).origin === baseUrl;
  } catch {
    return false;
  }
}

module.exports = { isInternalAppUrl };
