// Settings page for the stream goal — same shape as countdown-settings.js:
// the form mirrors whatever the server broadcasts, and the card below it
// shows the live count rather than a mock-up.
(function () {
  const form = document.getElementById('goal-form');
  const metricSelect = document.getElementById('goal-metric');
  const targetInput = document.getElementById('goal-target');
  const labelInput = document.getElementById('goal-label');
  const colorInput = document.getElementById('goal-color');
  const colorHexInput = document.getElementById('goal-color-hex');
  const resetBtn = document.getElementById('goal-reset-btn');

  const previewEl = document.getElementById('goal-preview');
  const previewLabel = document.getElementById('goal-preview-label');
  const previewValue = document.getElementById('goal-preview-value');
  const previewFill = document.getElementById('goal-preview-fill');
  const sinceEl = document.getElementById('goal-since');

  const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

  // The most recent server state. The form is only pre-filled from it, never
  // driven by it while typing — otherwise a broadcast landing mid-edit (an
  // alert arrives and bumps the count) would yank the field out from under
  // the cursor.
  let status = null;

  function syncHexFromPicker() {
    colorHexInput.value = colorInput.value.toUpperCase();
    colorHexInput.classList.remove('is-invalid');
  }

  colorInput.addEventListener('input', () => {
    syncHexFromPicker();
    renderPreview();
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
    renderPreview();
  });

  [metricSelect, targetInput, labelInput].forEach((el) => {
    el.addEventListener('input', renderPreview);
  });

  const METRIC_LABELS = {
    follow: 'Follower',
    subscription: 'Neue Subs',
    giftsub: 'Gift-Subs',
    bits: 'Bits',
  };

  // Shows what the form currently says, with the count from the server —
  // adjusting the target moves the bar immediately instead of only after
  // saving.
  function renderPreview() {
    const target = Math.max(0, Math.round(Number(targetInput.value)) || 0);
    const current = status ? status.current : 0;
    const percent = target > 0 ? Math.min(100, (current / target) * 100) : 0;

    previewLabel.textContent = labelInput.value || t(METRIC_LABELS[metricSelect.value] || '');
    previewValue.textContent = `${current} / ${target || '—'}`;
    previewFill.style.width = `${percent}%`;
    previewEl.style.setProperty('--goal-accent', colorInput.value);

    // While no goal exists yet, give the embedded overlay the same unsaved
    // form values as this local preview. An active goal continues to show
    // its genuine live state, matching OBS.
    if (!status || !(status.target > 0)) {
      window.SynsaOverlayPreview?.setStatus({
        target,
        current,
        label: labelInput.value || METRIC_LABELS[metricSelect.value] || '',
        accentColor: colorInput.value,
      });
    }
  }

  function renderSince() {
    if (!status || !status.startedAt) {
      sinceEl.textContent = '';
      return;
    }
    const started = new Date(status.startedAt);
    sinceEl.textContent = `${t('Gezählt seit')} ${started.toLocaleDateString()} ${started.toLocaleTimeString()} · ${t(
      METRIC_LABELS[status.metric] || status.metric
    )}`;
  }

  function applyGoal(next) {
    if (!next) return;
    const firstLoad = status === null;
    status = next;

    // The form is filled from the server on first load and after an explicit
    // save/reset; later count updates only move the bar. Comparing the whole
    // settings block rather than a flag keeps a change made in a second open
    // tab visible here too.
    const settingsChanged =
      firstLoad ||
      metricSelect.value !== next.metric ||
      Number(targetInput.value) !== next.target ||
      (document.activeElement !== labelInput && labelInput.value !== next.label);

    if (settingsChanged && document.activeElement !== targetInput) {
      metricSelect.value = next.metric;
      if (next.target > 0) targetInput.value = next.target;
      labelInput.value = next.label;
      colorInput.value = next.accentColor;
      syncHexFromPicker();
    }

    renderPreview();
    renderSince();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = Math.round(Number(targetInput.value));
    if (!Number.isFinite(target) || target < 1) return;

    await fetch('/api/goal/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        metric: metricSelect.value,
        target,
        label: labelInput.value,
        accentColor: colorInput.value,
      }),
    });
  });

  resetBtn.addEventListener('click', async () => {
    await fetch('/api/goal/reset', { method: 'POST' });
  });

  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state && msg.state.goal) applyGoal(msg.state.goal);
    if (msg.kind === 'goal-status') applyGoal(msg.status);
  }

  async function loadInitial() {
    try {
      const res = await fetch('/api/goal/status');
      if (res.ok) applyGoal(await res.json());
    } catch {
      // The WS connection catches up once it opens.
    }
  }

  renderPreview();
  loadInitial();
  connectPageSocket(handleMessage);
})();
