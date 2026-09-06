// "Über SYNSA" — which version is installed, an on-demand update check, and
// the release history. Reached from the gear menu, below the settings.
//
// The update state itself belongs to shared/update-banner.js (an available
// update is rendered by the banner, on this page as on every other) — the
// check button here only has to cover the one case the banner never shows:
// that nothing was found.
(function () {
  const versionTextEl = document.getElementById('about-version-text');
  const versionNoteEl = document.getElementById('about-version-note');
  const checkBtn = document.getElementById('update-check-btn');
  const feedbackEl = document.getElementById('update-check-feedback');
  const changelogBox = document.getElementById('changelog-box');

  const FEEDBACK_MS = 5000;
  let feedbackHideTimer = null;

  function showFeedback(text) {
    clearTimeout(feedbackHideTimer);
    feedbackEl.textContent = text;
    feedbackEl.classList.add('is-visible');
    feedbackHideTimer = setTimeout(() => feedbackEl.classList.remove('is-visible'), FEEDBACK_MS);
  }

  function loadVersion() {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !data.version) return;
        versionTextEl.textContent = `SYNSA ${data.version}`;
        versionNoteEl.textContent = t('Installierte Version');
      })
      .catch(() => {
        versionNoteEl.textContent = t('Version konnte nicht gelesen werden.');
      });
  }

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    try {
      const res = await fetch('/api/update/check', { method: 'POST' });
      const state = await res.json();
      if (state.phase === 'idle') showFeedback(t('SYNSA ist aktuell.'));
    } catch {
      showFeedback(t('Update-Check fehlgeschlagen.'));
    } finally {
      checkBtn.disabled = false;
    }
  });

  loadVersion();
  loadChangelog(changelogBox);
  connectPageSocket();
})();
