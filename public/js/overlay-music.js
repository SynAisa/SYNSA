(function () {
  const card = document.getElementById('card');
  const coverEl = document.getElementById('cover');
  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const fillEl = document.getElementById('progress-fill');
  const elapsedEl = document.getElementById('time-elapsed');
  const totalEl = document.getElementById('time-total');

  let ws = null;

  // The settings page embeds this same page with ?preview=1. Without a paired
  // source — or with one that simply is not playing anything — the overlay
  // correctly shows nothing at all, which is right in OBS and useless in a
  // preview box. Only in preview mode that empty state is filled with an
  // obvious sample instead. Real data always wins: the moment a genuine song
  // arrives it replaces this like any other track change.
  const IS_PREVIEW = new URLSearchParams(location.search).has('preview');

  // Drawn inline rather than fetched: an overlay must not depend on a network
  // request to render, least of all for a placeholder.
  const DEMO_COVER =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
        "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
        "<stop offset='0' stop-color='#17665B'/><stop offset='1' stop-color='#0B1112'/>" +
        '</linearGradient></defs>' +
        "<rect width='300' height='300' fill='url(#g)'/>" +
        "<circle cx='150' cy='150' r='58' fill='none' stroke='#35C9A8' stroke-width='6'/>" +
        "<circle cx='150' cy='150' r='12' fill='#35C9A8'/>" +
        '</svg>'
    );

  // Paused on purpose: a preview that animates for three and a half minutes
  // and then fades itself out would only be confusing.
  const DEMO_STATUS = {
    connected: true,
    title: 'Beispielsong',
    artist: 'SYNSA-Vorschau',
    thumbnail: DEMO_COVER,
    durationSeconds: 214,
    progressSeconds: 76,
    isPlaying: false,
  };

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
      // DEMO_STATUS passes the check above, so this hands over exactly once
      // and cannot loop.
      if (IS_PREVIEW) {
        onStatus(DEMO_STATUS);
        return;
      }
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
      // The embedded preview on the settings page loads this same URL with
      // ?preview=1. It must not count as a Browser Source in OBS, or the
      // connection status on that very page would always read "connected".
      if (!IS_PREVIEW) {
        ws.send(JSON.stringify({ kind: 'register', role: 'overlay-music' }));
      }
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

  // Without a music source there is no state.music in the snapshot at all, so
  // onStatus would never run and the preview would stay blank. Seeding it here
  // paints the sample right away; the first real broadcast overwrites it.
  if (IS_PREVIEW) onStatus(null);

  connect();
})();
