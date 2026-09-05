(function () {
  const statusEl = document.getElementById('status');
  const versionTextEl = document.getElementById('update-version-text');
  const checkBtn = document.getElementById('update-check-btn');
  const feedbackEl = document.getElementById('update-check-feedback');

  let ws;
  let feedbackHideTimer = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => setStatus(true));
    ws.addEventListener('close', () => {
      setStatus(false);
      setTimeout(connect, 1500);
    });
    ws.addEventListener('error', () => ws.close());
  }

  function setStatus(connected) {
    statusEl.textContent = connected ? 'Verbunden' : 'Getrennt – versuche erneut…';
    statusEl.classList.toggle('is-connected', connected);
  }

  function showFeedback(text) {
    clearTimeout(feedbackHideTimer);
    feedbackEl.textContent = text;
    feedbackEl.classList.add('is-visible');
    feedbackHideTimer = setTimeout(() => feedbackEl.classList.remove('is-visible'), 5000);
  }

  function loadVersion() {
    fetch('/api/version')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.version) versionTextEl.textContent = `Installierte Version: ${data.version}`;
      })
      .catch(() => {
        // Not critical for this page to function.
      });
  }

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    try {
      const res = await fetch('/api/update/check', { method: 'POST' });
      const state = await res.json();
      // An "available" result is rendered by update-banner.js via its own
      // WebSocket broadcast — this only needs to cover the case that script
      // doesn't show anything for: nothing found.
      if (state.phase === 'idle') {
        showFeedback('SYNSA ist aktuell.');
      }
    } catch {
      showFeedback('Update-Check fehlgeschlagen.');
    } finally {
      checkBtn.disabled = false;
    }
  });

  loadVersion();
  connect();
})();
