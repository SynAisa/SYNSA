(function () {
  const statusEl = document.getElementById('status');
  const form = document.getElementById('countdown-form');
  const minutesInput = document.getElementById('countdown-minutes');
  const secondsInput = document.getElementById('countdown-seconds');
  const labelInput = document.getElementById('countdown-label');
  const colorInput = document.getElementById('countdown-color');
  const colorHexInput = document.getElementById('countdown-color-hex');
  const fontSizeSelect = document.getElementById('countdown-fontsize');
  const startBtn = document.getElementById('countdown-start-btn');
  const stopBtn = document.getElementById('countdown-stop-btn');
  const liveEl = document.getElementById('countdown-live');
  const presetBtns = document.querySelectorAll('.countdown-preset-btn');

  const previewBox = document.getElementById('countdown-preview-box');
  const previewLabel = document.getElementById('countdown-preview-label');
  const previewValue = document.getElementById('countdown-preview-value');

  let ws;
  let tickTimer = null;
  // While a countdown is actually running, the preview mirrors the real
  // server-driven value (what's genuinely on screen right now) instead of
  // the form fields, which applyCountdown() overwrites anyway once running.
  let runningStatus = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => setStatus(true));
    ws.addEventListener('close', () => {
      setStatus(false);
      setTimeout(connect, 1500);
    });
    ws.addEventListener('error', () => ws.close());
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.kind === 'state' && msg.state && msg.state.countdown) applyCountdown(msg.state.countdown);
        if (msg.kind === 'countdown-status') applyCountdown(msg.status);
      } catch {
        // ignore malformed messages
      }
    });
  }

  function setStatus(connected) {
    statusEl.textContent = connected ? 'Verbunden' : 'Getrennt – versuche erneut…';
    statusEl.classList.toggle('is-connected', connected);
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  // Same 65%-alpha glow math as the real overlay (public/js/overlay-countdown.js)
  // so the preview matches what OBS will actually show, not an approximation.
  function glowFrom(hex) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) return 'rgba(53, 201, 168, 0.65)';
    const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
    return `rgba(${r}, ${g}, ${b}, 0.65)`;
  }

  function renderPreviewChrome() {
    previewLabel.textContent = labelInput.value || 'Starting Soon';
    previewBox.className = `countdown-preview-box size-${fontSizeSelect.value}`;
    previewBox.style.setProperty('--countdown-preview-glow', glowFrom(colorInput.value));
  }

  // Called on every keystroke/change while stopped, so adjusting the form
  // shows its effect immediately instead of only after pressing Start.
  function updatePreviewFromForm() {
    if (runningStatus) return;
    renderPreviewChrome();
    const minutes = parseInt(minutesInput.value, 10) || 0;
    const seconds = parseInt(secondsInput.value, 10) || 0;
    previewValue.textContent = formatDuration(minutes * 60 + seconds);
  }

  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  // <input type="color"> has no visible code, just a swatch — this keeps a
  // plain hex field next to it in sync both ways, so the color can be typed
  // in directly instead of only picked.
  function syncHexFromPicker() {
    colorHexInput.value = colorInput.value.toUpperCase();
    colorHexInput.classList.remove('is-invalid');
  }

  colorInput.addEventListener('input', syncHexFromPicker);

  colorHexInput.addEventListener('input', () => {
    const value = colorHexInput.value.trim();
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (!HEX_COLOR_RE.test(normalized)) {
      colorHexInput.classList.add('is-invalid');
      return;
    }
    colorHexInput.classList.remove('is-invalid');
    colorInput.value = normalized;
    updatePreviewFromForm();
  });

  [minutesInput, secondsInput, labelInput, colorInput, fontSizeSelect].forEach((el) => {
    el.addEventListener('input', updatePreviewFromForm);
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      minutesInput.value = btn.dataset.minutes;
      secondsInput.value = 0;
      updatePreviewFromForm();
    });
  });

  function applyCountdown(status) {
    if (!status) return;

    clearInterval(tickTimer);
    tickTimer = null;

    // Always mirror the server's values, running or not. Skipping this
    // while running left the fields on their blank HTML defaults after a
    // reload, so pressing Start again submitted an empty label and wiped it.
    minutesInput.value = Math.floor(status.durationSeconds / 60);
    secondsInput.value = status.durationSeconds % 60;
    labelInput.value = status.label;
    colorInput.value = status.accentColor;
    syncHexFromPicker();
    fontSizeSelect.value = status.fontSize;

    if (!status.running) {
      runningStatus = null;
      startBtn.hidden = false;
      stopBtn.hidden = true;
      liveEl.textContent = '';
      updatePreviewFromForm();
      return;
    }

    runningStatus = status;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    renderPreviewChrome();

    const tick = () => {
      const remaining = (status.endsAt - Date.now()) / 1000;
      liveEl.textContent = remaining > 0 ? `Läuft noch: ${formatDuration(remaining)}` : 'Bei 0:00 angekommen';
      previewValue.textContent = formatDuration(Math.max(0, remaining));
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = parseInt(minutesInput.value, 10) || 0;
    const seconds = parseInt(secondsInput.value, 10) || 0;
    const durationSeconds = minutes * 60 + seconds;
    if (durationSeconds <= 0) return;

    await fetch('/api/countdown/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        durationSeconds,
        label: labelInput.value,
        accentColor: colorInput.value,
        fontSize: fontSizeSelect.value,
      }),
    });
  });

  stopBtn.addEventListener('click', async () => {
    await fetch('/api/countdown/stop', { method: 'POST' });
  });

  async function loadInitial() {
    try {
      const res = await fetch('/api/countdown/status');
      if (res.ok) applyCountdown(await res.json());
    } catch {
      // WS connection will catch up once it opens
    }
  }

  updatePreviewFromForm();
  loadInitial();
  connect();
})();
