// Real semantic-version comparison — not string comparison, so "0.1.0" <
// "0.1.1" < "0.2.0" < "1.0.0" all resolve correctly regardless of digit
// count. Only compares the numeric major.minor.patch(.*) segments; pre-release
// suffixes (e.g. "-beta.1") are intentionally out of scope for Phase 2A
// (stable releases only — see update/manager.js), but normalizing a leading
// "v" here means a real release tag like "v0.1.1" can be compared safely
// later without every caller needing to know about that formatting detail.
function normalizeVersion(version) {
  return String(version).trim().replace(/^v/i, '');
}

function parseVersion(version) {
  return normalizeVersion(version)
    .split('.')
    .map((part) => parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

// Same contract as a standard sort comparator: negative if a < b, positive
// if a > b, 0 if equal.
function compareVersions(a, b) {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function isNewerVersion(currentVersion, candidateVersion) {
  return compareVersions(candidateVersion, currentVersion) > 0;
}

module.exports = { normalizeVersion, compareVersions, isNewerVersion };
