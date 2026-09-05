// First-run setup: links the Twitch account through the device code flow.
//
// The page only drives and displays the flow — starting it, polling Twitch
// and storing the tokens all happen in the server (twitch/deviceAuth.js), so
// closing this window while approving in the browser does not lose the
// connection.
(function () {
  const dot = document.getElementById('connect-dot');
  const title = document.getElementById('connect-title');
  const subtitle = document.getElementById('connect-subtitle');
  const connectBtn = document.getElementById('connect-btn');
  const continueLink = document.getElementById('connect-continue');
  const errorEl = document.getElementById('connect-error');
  const deviceStep = document.getElementById('device-step');
  const deviceCode = document.getElementById('device-code');
  const deviceOpen = document.getElementById('device-open');
  const deviceCancel = document.getElementById('device-cancel');
  const deviceHint = document.getElementById('device-hint');

  // Only while a code is outstanding. The moment it is approved (or fails)
  // this stops — no permanent background polling from the page.
  const POLL_INTERVAL_MS = 2000;
  let pollTimer = null;

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function showError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  function renderConnected() {
    stopPolling();
    dot.dataset.state = 'connected';
    title.textContent = 'Twitch-Konto verbunden';
    subtitle.textContent = 'SYNSA kann jetzt Alerts, Chat und Streaminfos verwenden.';
    deviceStep.hidden = true;
    connectBtn.hidden = true;
    continueLink.hidden = false;
    showError('');
  }

  function renderWaiting(state) {
    dot.dataset.state = 'waiting';
    title.textContent = 'Warte auf deine Bestätigung';
    subtitle.textContent = 'Der Code gilt nur für kurze Zeit.';
    deviceStep.hidden = false;
    deviceCode.textContent = state.userCode || '––––––';
    if (state.verificationUri) deviceOpen.href = state.verificationUri;
    deviceHint.textContent = 'SYNSA wartet auf deine Bestätigung …';
    connectBtn.hidden = true;
    continueLink.hidden = true;
    showError('');
  }

  function renderIdle(message) {
    stopPolling();
    dot.dataset.state = 'idle';
    title.textContent = 'Noch nicht verbunden';
    subtitle.textContent = 'Ein Klick, dann bestätigst du bei Twitch.';
    deviceStep.hidden = true;
    connectBtn.hidden = false;
    connectBtn.disabled = false;
    connectBtn.textContent = message ? 'Erneut versuchen' : 'Mit Twitch verbinden';
    continueLink.hidden = true;
    showError(message || '');
  }

  function renderMissingClientId() {
    stopPolling();
    dot.dataset.state = 'error';
    title.textContent = 'Verbindung nicht möglich';
    subtitle.textContent = 'Dieser SYNSA-Version fehlt die Twitch-Client-ID.';
    deviceStep.hidden = true;
    connectBtn.hidden = true;
    continueLink.hidden = true;
    showError('Bitte eine vollständige SYNSA-Version installieren.');
  }

  function render(state) {
    if (!state) return;

    if (state.hasClientId === false) {
      renderMissingClientId();
      return;
    }

    if (state.status === 'connected') {
      renderConnected();
      return;
    }
    if (state.status === 'waiting') {
      renderWaiting(state);
      return;
    }
    if (state.status === 'error') {
      renderIdle(state.error || 'Die Verbindung ist fehlgeschlagen.');
      return;
    }
    renderIdle('');
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/twitch/device/status');
        if (!res.ok) return;
        const state = await res.json();
        if (state.status !== 'waiting') stopPolling();
        render(state);
      } catch {
        // Keep waiting: a failed status poll says nothing about whether the
        // user has approved, and the server keeps polling Twitch regardless.
      }
    }, POLL_INTERVAL_MS);
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Wird vorbereitet …';
    showError('');

    try {
      const res = await fetch('/api/twitch/device/start', { method: 'POST' });
      const state = await res.json();
      render(state);
      if (state.status === 'waiting') startPolling();
    } catch {
      renderIdle('Twitch ist gerade nicht erreichbar.');
    }
  });

  deviceCancel.addEventListener('click', async () => {
    stopPolling();
    try {
      await fetch('/api/twitch/device/cancel', { method: 'POST' });
    } catch {
      // Cancelling is a local intent — show it either way.
    }
    renderIdle('');
  });

  // Initial state: an account may already be linked (someone opened this page
  // from the control panel), or a flow may still be running from before.
  Promise.all([
    fetch('/api/setup/status').then((res) => (res.ok ? res.json() : null)),
    fetch('/api/twitch/device/status').then((res) => (res.ok ? res.json() : null)),
  ])
    .then(([setup, device]) => {
      if (setup && setup.hasClientId === false) {
        renderMissingClientId();
        return;
      }
      if (setup && setup.connected) {
        renderConnected();
        return;
      }
      render(device);
      if (device && device.status === 'waiting') startPolling();
    })
    .catch(() => renderIdle(''));
})();
