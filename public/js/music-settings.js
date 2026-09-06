(function () {
  const musicStatusText = document.getElementById('music-status-text');
  const connectBtn = document.getElementById('music-connect-btn');
  const disconnectBtn = document.getElementById('music-disconnect-btn');
  const pairNote = document.getElementById('music-pair-note');

  const nowPlayingCard = document.getElementById('music-nowplaying-card');
  const nowPlayingCover = document.getElementById('music-nowplaying-cover');
  const nowPlayingTitle = document.getElementById('music-nowplaying-title');
  const nowPlayingArtist = document.getElementById('music-nowplaying-artist');

  const showCoverInput = document.getElementById('music-show-cover');
  const accentColorInput = document.getElementById('music-accent-color');
  const accentColorHexInput = document.getElementById('music-accent-color-hex');

  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state && msg.state.music) applyMusicStatus(msg.state.music);
    if (msg.kind === 'music-status') applyMusicStatus(msg.status);
    if (msg.kind === 'state' && msg.state && msg.state.musicSettings) applySettings(msg.state.musicSettings);
    if (msg.kind === 'music-settings') applySettings(msg.settings);
  }

  function applyMusicStatus(status) {
    if (!status) return;
    if (status.connected) {
      musicStatusText.textContent = t('Verbunden');
      musicStatusText.classList.add('is-connected');
      connectBtn.hidden = true;
      disconnectBtn.hidden = false;
    } else {
      musicStatusText.textContent = t('Nicht verbunden');
      musicStatusText.classList.remove('is-connected');
      connectBtn.hidden = false;
      disconnectBtn.hidden = true;
    }

    // A separate card rather than folding this into the status line above:
    // "Verbunden" answers "is the pairing alive", "Jetzt läuft" answers "is
    // a song actually playing right now" — two different questions that a
    // combined line kept blurring together.
    if (status.connected && status.title) {
      nowPlayingCard.hidden = false;
      nowPlayingTitle.textContent = status.title;
      nowPlayingArtist.textContent = status.artist || '';
      if (status.thumbnail && nowPlayingCover.src !== status.thumbnail) {
        nowPlayingCover.src = status.thumbnail;
      }
    } else {
      nowPlayingCard.hidden = true;
    }
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/music/status');
      const data = await res.json();
      applyMusicStatus({ connected: data.connected });
    } catch {
      // WS connection will catch up once it opens
    }
  }

  // Mirrors the server's values into the form without re-triggering a save
  // — this fires both on the initial WS 'state' snapshot and after this
  // same page's own POST broadcasts the change back to every client.
  function applySettings(settings) {
    if (!settings) return;
    showCoverInput.checked = Boolean(settings.showCover);
    accentColorInput.value = settings.accentColor;
    syncHexFromPicker();
  }

  function saveSettings() {
    fetch('/api/music/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showCover: showCoverInput.checked, accentColor: accentColorInput.value }),
    }).catch(() => {
      // A dropped save here just means the overlay keeps its last-known
      // display settings — not worth surfacing an error for.
    });
  }

  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  // <input type="color"> has no visible code, just a swatch — this keeps a
  // plain hex field next to it in sync both ways, so the color can be typed
  // in directly instead of only picked.
  function syncHexFromPicker() {
    accentColorHexInput.value = accentColorInput.value.toUpperCase();
    accentColorHexInput.classList.remove('is-invalid');
  }

  accentColorInput.addEventListener('input', syncHexFromPicker);

  accentColorHexInput.addEventListener('input', () => {
    const value = accentColorHexInput.value.trim();
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (!HEX_COLOR_RE.test(normalized)) {
      accentColorHexInput.classList.add('is-invalid');
      return;
    }
    accentColorHexInput.classList.remove('is-invalid');
    accentColorInput.value = normalized;
    saveSettings();
  });

  showCoverInput.addEventListener('change', saveSettings);
  accentColorInput.addEventListener('input', saveSettings);

  async function loadSettings() {
    try {
      const res = await fetch('/api/music/settings');
      if (res.ok) applySettings(await res.json());
    } catch {
      // WS connection will catch up once it opens
    }
  }

  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    pairNote.hidden = false;
    pairNote.textContent = t('Bitte in YTMDesktop die Verbindungsanfrage bestätigen (bis zu 30 Sekunden)…');
    try {
      const res = await fetch('/api/music/pair', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(t(data.error || 'Pairing fehlgeschlagen'));
      pairNote.textContent = t('Verbunden!');
      setTimeout(() => {
        pairNote.hidden = true;
      }, 2000);
    } catch (err) {
      pairNote.textContent = t('Fehler: {msg}').replace('{msg}', err.message);
    } finally {
      connectBtn.disabled = false;
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    disconnectBtn.disabled = true;
    try {
      await fetch('/api/music/unpair', { method: 'POST' });
      applyMusicStatus({ connected: false });
    } finally {
      disconnectBtn.disabled = false;
    }
  });

  refreshStatus();
  loadSettings();
  connectPageSocket(handleMessage);
})();
