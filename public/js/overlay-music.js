(function () {
  const card = document.getElementById('card');
  const coverEl = document.getElementById('cover');
  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const fillEl = document.getElementById('progress-fill');
  const elapsedEl = document.getElementById('time-elapsed');
  const totalEl = document.getElementById('time-total');

  let ws = null;

  // local progress interpolation state
  let lastKnownProgress = 0; // seconds
  let lastKnownAt = 0; // performance.now() timestamp
  let durationSeconds = 0;
  let isPlaying = false;

  // track-change animation state
  let currentTrackKey = null;
  let trackTransitionSeq = 0;
  let preFadeActive = false;
  let preFadeStartedAt = 0;
  let transitionPending = false;
  const TRACK_END_FADE_LEAD = 0.7;

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function beginTrackTransition(newTitle, newArtist, thumb) {
    const mySeq = ++trackTransitionSeq;
    transitionPending = true;
    const alreadyFaded = preFadeActive;

    const swapContent = () => {
      if (mySeq !== trackTransitionSeq) return;
      titleEl.textContent = newTitle;
      artistEl.textContent = newArtist;
      if (thumb) coverEl.src = thumb;
      preFadeActive = false;
      transitionPending = false;
      requestAnimationFrame(() => {
        if (mySeq !== trackTransitionSeq) return;
        coverEl.classList.remove('track-out');
        titleEl.classList.remove('track-out');
        artistEl.classList.remove('track-out');
      });
    };

    const runFade = () => {
      if (mySeq !== trackTransitionSeq) return;
      coverEl.classList.add('track-out');
      titleEl.classList.add('track-out');
      artistEl.classList.add('track-out');
      setTimeout(swapContent, alreadyFaded ? 0 : 200);
    };

    if (!thumb) {
      runFade();
      return;
    }

    let settled = false;
    const preload = new Image();
    preload.onload = () => {
      if (settled) return;
      settled = true;
      if (mySeq !== trackTransitionSeq) return;
      runFade();
    };
    preload.onerror = () => {
      if (settled) return;
      settled = true;
      if (mySeq !== trackTransitionSeq) return;
      preFadeActive = false;
      transitionPending = false;
      coverEl.classList.remove('track-out');
      titleEl.classList.remove('track-out');
      artistEl.classList.remove('track-out');
      titleEl.textContent = newTitle;
      artistEl.textContent = newArtist;
    };
    preload.src = thumb;
    setTimeout(() => {
      if (settled) return;
      settled = true;
      if (mySeq !== trackTransitionSeq) return;
      runFade();
    }, 800);
  }

  // Same approach as overlay-countdown.js: derive shades from the
  // configured accent in JS instead of color-mix(), which an older OBS's
  // bundled CEF may not support at all.
  function hexToRgb(hex) {
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return match ? match.slice(1).map((part) => parseInt(part, 16)) : [53, 201, 168];
  }

  function darken(hex, factor) {
    const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * factor));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function dim(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applySettings(settings) {
    if (!settings) return;
    const accent = settings.accentColor || '#35C9A8';
    const root = document.documentElement.style;
    root.setProperty('--accent', accent);
    root.setProperty('--accent-deep', darken(accent, 0.45));
    root.setProperty('--accent-dim', dim(accent, 0.35));
    card.classList.toggle('no-cover', settings.showCover === false);
  }

  function onStatus(status) {
    if (!status || !status.connected || !status.title) {
      card.classList.remove('visible');
      currentTrackKey = null;
      durationSeconds = 0;
      isPlaying = false;
      stopTicking();
      return;
    }

    card.classList.add('visible');

    const newTitle = status.title || '';
    const newArtist = status.artist || '';
    const thumb = status.thumbnail || '';
    const newKey = newTitle + '::' + newArtist;
    const isNewTrack = currentTrackKey !== null && newKey !== currentTrackKey;
    currentTrackKey = newKey;

    if (isNewTrack) {
      beginTrackTransition(newTitle, newArtist, thumb);
    } else if (!transitionPending) {
      titleEl.textContent = newTitle;
      artistEl.textContent = newArtist;
      if (thumb && coverEl.src !== thumb) coverEl.src = thumb;
    }

    durationSeconds = status.durationSeconds || 0;
    totalEl.textContent = fmt(durationSeconds);

    isPlaying = Boolean(status.isPlaying);
    card.classList.toggle('paused', !isPlaying);

    lastKnownProgress = status.progressSeconds || 0;
    lastKnownAt = performance.now();

    // Paint the new position right away, then let the loop take over only
    // if it actually has something to animate.
    renderProgress();
    if (isPlaying) startTicking();
  }

  function renderProgress() {
    if (durationSeconds <= 0) return;

    let progress = lastKnownProgress;
    if (isPlaying) {
      progress += (performance.now() - lastKnownAt) / 1000;
    }
    progress = Math.min(progress, durationSeconds);
    elapsedEl.textContent = fmt(progress);
    fillEl.style.width = Math.min(100, (progress / durationSeconds) * 100) + '%';

    const remaining = durationSeconds - progress;
    if (isPlaying && !preFadeActive && remaining >= 0 && remaining <= TRACK_END_FADE_LEAD) {
      preFadeActive = true;
      preFadeStartedAt = performance.now();
      coverEl.classList.add('track-out');
      titleEl.classList.add('track-out');
      artistEl.classList.add('track-out');
    } else if (preFadeActive && !transitionPending && performance.now() - preFadeStartedAt > 3000) {
      preFadeActive = false;
      coverEl.classList.remove('track-out');
      titleEl.classList.remove('track-out');
      artistEl.classList.remove('track-out');
    }
  }

  // This overlay sits in an OBS Browser Source for the whole stream, so an
  // always-on 60fps loop would burn CPU around the clock for a progress bar
  // that is two pixels tall. It runs only while something is actually
  // playing, at 10Hz — past that nothing is visible anyway.
  //
  // A timer rather than requestAnimationFrame on purpose: rAF is tied to
  // compositing, so it drops to ~1fps (or stalls entirely) whenever the
  // page isn't being painted, which would silently freeze the elapsed time
  // instead of just rendering it less often. At 10Hz there is nothing to
  // gain from being frame-synced.
  const RENDER_INTERVAL_MS = 100;
  let tickTimer = null;

  function startTicking() {
    if (tickTimer !== null) return;
    tickTimer = setInterval(() => {
      if (!isPlaying && !preFadeActive) {
        stopTicking();
        return;
      }
      renderProgress();
    }, RENDER_INTERVAL_MS);
  }

  function stopTicking() {
    if (tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  // Backs off instead of retrying twice a second forever while the app is
  // closed — this source lives in OBS for the whole stream.
  let retryDelay = 1500;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      retryDelay = 1500;
      // Announces this source the way overlay.js does. Nothing here depends
      // on it — there is no primary/secondary role for the music overlay —
      // but it is the only way the server can tell whether this overlay is
      // set up in OBS at all, which the diagnostics page reports.
      ws.send(JSON.stringify({ kind: 'register', role: 'overlay-music' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.kind === 'state' && msg.state && msg.state.music) onStatus(msg.state.music);
        if (msg.kind === 'music-status') onStatus(msg.status);
        if (msg.kind === 'state' && msg.state && msg.state.musicSettings) applySettings(msg.state.musicSettings);
        if (msg.kind === 'music-settings') applySettings(msg.settings);
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
