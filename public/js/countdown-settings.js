(function () {
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

  // The page used to carry a second, locally drawn "Entwurf" box next to the
  // embedded overlay preview. Both showed the same thing whenever nothing was
  // running, so the drawn copy — and the glow/size maths it needed to stay in
  // step with the real overlay — is gone. What is left here drives the
  // "Läuft noch: …" line only.
  let tickTimer = null;
  let currentStatus = null;

  function updateOverlayPreview() {
    // A running countdown is intentionally left as the real live state. The
    // sample is only for the stopped, editable setup state.
    if (currentStatus && currentStatus.running) return;
    window.SynsaOverlayPreview?.setStatus({
      running: false,
      durationSeconds: (parseInt(minutesInput.value, 10) || 0) * 60 + (parseInt(secondsInput.value, 10) || 0),
      label: labelInput.value,
      accentColor: colorInput.value,
      fontSize: fontSizeSelect.value,
    });
  }

  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state && msg.state.countdown) applyCountdown(msg.state.countdown);
    if (msg.kind === 'countdown-status') applyCountdown(msg.status);
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  // <input type="color"> has no visible code, just a swatch — this keeps a
  // plain hex field next to it in sync both ways, so the color can be typed
  // in directly instead of only picked.
  function syncHexFromPicker() {
    colorHexInput.value = colorInput.value.toUpperCase();
    colorHexInput.classList.remove('is-invalid');
  }

  colorInput.addEventListener('input', () => {
    syncHexFromPicker();
    updateOverlayPreview();
  });

  colorHexInput.addEventListener('input', () => {
    const value = colorHexInput.value.trim();
    const normalized = value.startsWith('#') ? value : `#${value}`;
    if (!HEX_COLOR_RE.test(normalized)) {
      colorHexInput.classList.add('is-invalid');
      return;
    }
    colorHexInput.classList.remove('is-invalid');
    colorInput.value = normalized;
    updateOverlayPreview();
  });

  [minutesInput, secondsInput, labelInput, fontSizeSelect].forEach((el) => {
    el.addEventListener('input', updateOverlayPreview);
  });

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      minutesInput.value = btn.dataset.minutes;
      secondsInput.value = 0;
      updateOverlayPreview();
    });
  });

  function applyCountdown(status) {
    if (!status) return;
    currentStatus = status;

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
      startBtn.hidden = false;
      stopBtn.hidden = true;
      liveEl.textContent = '';
      updateOverlayPreview();
      return;
    }

    startBtn.hidden = true;
    stopBtn.hidden = false;

    const tick = () => {
      const remaining = (status.endsAt - Date.now()) / 1000;
      liveEl.textContent =
        remaining > 0 ? t('Läuft noch: {t}').replace('{t}', formatDuration(remaining)) : t('Bei 0:00 angekommen');
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  const { showToast } = window.SynsaUI;

  // Submitted by the Start button and by Enter in any of the fields — the
  // latter is plain HTML form behaviour and needs nothing extra, which is
  // exactly why the duration fields can lose their stepper arrows without
  // losing a way to confirm.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = parseInt(minutesInput.value, 10) || 0;
    const seconds = parseInt(secondsInput.value, 10) || 0;
    const durationSeconds = minutes * 60 + seconds;
    if (durationSeconds <= 0) {
      showToast(t('Bitte eine Dauer über 0 eingeben.'));
      return;
    }

    // Until now this was a silent await: on success nothing happened on
    // screen except the countdown quietly starting, and on failure nothing
    // happened at all.
    try {
      const res = await fetch('/api/countdown/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationSeconds,
          label: labelInput.value,
          accentColor: colorInput.value,
          fontSize: fontSizeSelect.value,
        }),
      });
      if (res.ok) showToast(t('Gespeichert'), 'success');
      else showToast(t('Speichern fehlgeschlagen.'));
    } catch {
      showToast(t('Speichern fehlgeschlagen.'));
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/countdown/stop', { method: 'POST' });
      if (!res.ok) showToast(t('Countdown konnte nicht gestoppt werden.'));
    } catch {
      showToast(t('Countdown konnte nicht gestoppt werden.'));
    }
  });

  async function loadInitial() {
    try {
      const res = await fetch('/api/countdown/status');
      if (res.ok) applyCountdown(await res.json());
    } catch {
      // WS connection will catch up once it opens
    }
  }

  loadInitial();
  connectPageSocket(handleMessage);
})();
