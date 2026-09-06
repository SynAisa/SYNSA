// Turns a GitHub release body into plain text lines for display.
//
// Shared deliberately: update/productionProvider.js needs it for the release
// electron-updater reports, and server.js needs the identical treatment for
// the changelog history the welcome screen shows — two places rendering the
// same release bodies differently would be a bug waiting to happen. Kept free
// of any electron/electron-updater dependency so server.js can use it under a
// plain `node server.js` run too.
//
// Only ever produces plain text: no markdown rendering and no HTML, so a
// release body can never inject markup into a page that displays it.

function toLines(releaseNotes, { limit = 20 } = {}) {
  if (!releaseNotes) return [];

  // electron-updater hands over either a plain string or, when several
  // versions are skipped at once, an array of { version, note } entries.
  const raw = Array.isArray(releaseNotes)
    ? releaseNotes.map((entry) => (entry && entry.note) || '').join('\n')
    : String(releaseNotes);

  return raw
    .replace(/<[^>]+>/g, '') // strip any embedded HTML from the release body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+|^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

module.exports = { toLines };
