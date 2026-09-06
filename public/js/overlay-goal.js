// Goal overlay for OBS. Same shape as overlay-countdown.js: one WebSocket
// with a growing backoff, state from the broadcast, no polling and no timers
// — a goal only changes when an alert arrives, and the server tells us.
(function () {
  const root = document.getElementById('goal-root');
  const labelEl = document.getElementById('goal-label');
  const valueEl = document.getElementById('goal-value');
  const fillEl = document.getElementById('goal-fill');

  let ws = null;

  // The glow is the accent at 65% alpha, mixed here rather than with CSS
  // color-mix() so it also works on the older Chromium builds some OBS
  // versions still ship. Same math as overlay-countdown.js.
  function glowFrom(hex) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) return 'rgba(53, 201, 168, 0.65)';
    const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
    return `rgba(${r}, ${g}, ${b}, 0.65)`;
  }

  function applyStatus(status) {
    // No target means nothing has been set up yet — an empty source beats a
    // "0 / 0" bar sitting on the stream.
    if (!status || !(status.target > 0)) {
      root.hidden = true;
      return;
    }

    root.hidden = false;

    const accent = status.accentColor || '#35C9A8';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-glow', glowFrom(accent));

    const current = Number(status.current) || 0;
    const target = Number(status.target) || 0;
    const percent = Math.min(100, (current / target) * 100);

    labelEl.textContent = status.label || '';
    valueEl.textContent = `${current} / ${target}`;
    fillEl.style.width = `${percent}%`;
    root.classList.toggle('is-reached', current >= target);
  }

  // Backs off instead of retrying twice a second forever while the app is
  // closed — this source lives in OBS for the whole stream.
  let retryDelay = 1500;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      retryDelay = 1500;
      // Purely so the server knows this Browser Source exists, for the
      // diagnostics page. No behaviour depends on it.
      ws.send(JSON.stringify({ kind: 'register', role: 'overlay-goal' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.kind === 'state' && msg.state && msg.state.goal) applyStatus(msg.state.goal);
        if (msg.kind === 'goal-status') applyStatus(msg.status);
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener('close', () => {
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, 30000);
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => ws.close());
  }

  connect();
})();
