(function () {
  const root = document.getElementById('countdown-root');
  const labelEl = document.getElementById('countdown-label');
  const valueEl = document.getElementById('countdown-value');

  let ws = null;
  let tickTimer = null;

  function fmt(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const ss = String(r).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  function stopTicking() {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  // The glow is the accent at 65% alpha. Done here rather than with CSS
  // color-mix() so it also works on the older Chromium builds some OBS
  // versions still ship.
  function glowFrom(hex) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!match) return 'rgba(53, 201, 168, 0.65)';
    const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
    return `rgba(${r}, ${g}, ${b}, 0.65)`;
  }

  function applyStatus(status) {
    stopTicking();

    if (!status || !status.running) {
      root.hidden = true;
      root.classList.remove('is-done');
      return;
    }

    root.hidden = false;
    root.classList.remove('size-small', 'size-medium', 'size-large');
    root.classList.add(`size-${status.fontSize || 'medium'}`);

    const accent = status.accentColor || '#35C9A8';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-glow', glowFrom(accent));

    labelEl.textContent = status.label || '';

    const render = () => {
      const remaining = (status.endsAt - Date.now()) / 1000;
      if (remaining <= 0) {
        valueEl.textContent = fmt(0);
        root.classList.add('is-done');
        stopTicking();
        return;
      }
      valueEl.textContent = fmt(remaining);
    };

    render();
    // A "starting soon" countdown only needs to visibly tick once a
    // second — no reason to burn cycles faster than that for the whole
    // pre-show wait.
    tickTimer = setInterval(render, 1000);
  }

  // Backs off instead of retrying twice a second forever while the app is
  // closed — this source lives in OBS for the whole stream.
  let retryDelay = 1500;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      retryDelay = 1500;
      // Same as overlay-music.js: purely so the server knows this Browser
      // Source exists, for the diagnostics page. No behaviour depends on it.
      ws.send(JSON.stringify({ kind: 'register', role: 'overlay-countdown' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.kind === 'state' && msg.state && msg.state.countdown) applyStatus(msg.state.countdown);
        if (msg.kind === 'countdown-status') applyStatus(msg.status);
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
