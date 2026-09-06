// Welcome screen shown on a fresh installation and again after every update.
//
// Deliberately contains no update logic of its own: it renders exactly the
// state UpdateManager publishes (the same state the update banner on every
// other page renders) and triggers the same endpoints. Whether an update
// exists, may be downloaded or may be installed is decided in
// update/manager.js and nowhere else.
(function () {
  const versionBadge = document.getElementById('version-badge');
  const statusDot = document.getElementById('status-dot');
  const statusTitle = document.getElementById('status-title');
  const statusSubtitle = document.getElementById('status-subtitle');
  const statusAction = document.getElementById('status-action');
  const progress = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressDetail = document.getElementById('progress-detail');
  const changelogBox = document.getElementById('changelog-box');
  const continueBtn = document.getElementById('continue-btn');
  const footerNote = document.getElementById('footer-note');

  const BLOCKED_MESSAGE = 'Während eines laufenden Streams wird nicht installiert.';

  let currentState = null;
  let actionBusy = false;

  // --- Formatting helpers ---------------------------------------------------

  function formatMB(bytes) {
    return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  }

  function formatSpeed(bytesPerSecond) {
    const mb = bytesPerSecond / 1024 / 1024;
    return mb >= 10 ? `${mb.toFixed(0)} MB/s` : `${mb.toFixed(1)} MB/s`;
  }

  function formatRemaining(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return t('noch {n} s').replace('{n}', Math.ceil(seconds));
    const minutes = Math.floor(seconds / 60);
    const rest = Math.ceil(seconds % 60);
    return t('noch {t} min').replace('{t}', `${minutes}:${String(rest).padStart(2, '0')}`);
  }

  // --- Download rate ---------------------------------------------------------

  // UpdateManager reports bytes and percent, not speed — the rate and the
  // remaining time are derived here from the deltas between two progress
  // events. Smoothed, because raw per-event rates jump around far too much to
  // read: without this the numbers flicker several times a second.
  const SMOOTHING = 0.3;
  let lastSample = null;
  let smoothedRate = null;

  function updateRate(download) {
    const now = Date.now();
    const bytes = download.downloadedBytes || 0;

    if (!lastSample) {
      lastSample = { bytes, at: now };
      return null;
    }

    const elapsed = (now - lastSample.at) / 1000;
    const gained = bytes - lastSample.bytes;
    // Ignore samples that are too close together (division noise) or that go
    // backwards, which a restarted download would produce.
    if (elapsed < 0.35 || gained < 0) return smoothedRate;

    lastSample = { bytes, at: now };
    const rate = gained / elapsed;
    smoothedRate = smoothedRate === null ? rate : smoothedRate * (1 - SMOOTHING) + rate * SMOOTHING;
    return smoothedRate;
  }

  function resetRate() {
    lastSample = null;
    smoothedRate = null;
  }

  // --- Rendering -------------------------------------------------------------

  function renderProgress(download) {
    if (!download) {
      progress.hidden = true;
      return;
    }

    progress.hidden = false;
    const percent = typeof download.percent === 'number' ? download.percent : 0;
    progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progressPercent.textContent = `${Math.round(percent)} %`;

    const parts = [];
    if (download.totalBytes) {
      parts.push(t('{a} von {b}').replace('{a}', formatMB(download.downloadedBytes || 0)).replace('{b}', formatMB(download.totalBytes)));
    }

    const rate = updateRate(download);
    if (rate && rate > 0) {
      parts.push(formatSpeed(rate));
      if (download.totalBytes) {
        const remaining = formatRemaining((download.totalBytes - (download.downloadedBytes || 0)) / rate);
        if (remaining) parts.push(remaining);
      }
    }

    progressDetail.textContent = parts.join(' · ');
  }

  function render(state) {
    currentState = state;

    if (state.currentVersion) versionBadge.textContent = `v${state.currentVersion}`;

    const release = state.release || {};
    statusAction.hidden = true;
    statusAction.disabled = actionBusy;
    continueBtn.disabled = false;
    footerNote.textContent = '';

    if (state.phase !== 'downloading') resetRate();
    renderProgress(state.phase === 'downloading' ? state.download : null);

    // {v} rather than a template literal: English puts the version in a
    // different place than German ("Downloading version 1.2" vs "Version 1.2
    // wird heruntergeladen"), so the placeholder has to be part of the
    // translated sentence, not glued around it.
    const withVersion = (german, version) => t(german).replace('{v}', version);

    switch (state.phase) {
      case 'checking':
        statusDot.dataset.state = 'checking';
        statusTitle.textContent = t('Suche nach Updates …');
        statusSubtitle.textContent = t('Einen Moment.');
        break;

      case 'available':
        statusDot.dataset.state = 'available';
        statusTitle.textContent = withVersion('Update auf Version {v} verfügbar', release.version);
        statusSubtitle.textContent = t('Du kannst es jetzt oder später installieren.');
        statusAction.hidden = false;
        statusAction.textContent = t('Jetzt aktualisieren');
        break;

      case 'downloading':
        statusDot.dataset.state = 'downloading';
        statusTitle.textContent = withVersion('Version {v} wird heruntergeladen', release.version);
        statusSubtitle.textContent = t('Du kannst währenddessen weitermachen.');
        break;

      case 'ready':
        statusDot.dataset.state = 'ready';
        statusTitle.textContent = withVersion('Version {v} ist bereit', release.version);
        statusSubtitle.textContent = state.installBlocked
          ? t(BLOCKED_MESSAGE)
          : t('SYNSA startet nach der Installation automatisch neu.');
        statusAction.hidden = false;
        statusAction.textContent = t('Jetzt installieren');
        statusAction.disabled = actionBusy || state.installBlocked;
        break;

      case 'installing':
        statusDot.dataset.state = 'downloading';
        statusTitle.textContent = t('SYNSA wird neu gestartet …');
        statusSubtitle.textContent = t('Die Aktualisierung wird abgeschlossen.');
        continueBtn.disabled = true;
        break;

      case 'error':
        statusDot.dataset.state = 'error';
        statusTitle.textContent = t('Update nicht möglich');
        // Server messages come through the same table: they are German
        // sentences too, so they translate exactly like the rest.
        statusSubtitle.textContent = t((state.error && state.error.message) || 'Unbekannter Fehler.');
        statusAction.hidden = false;
        statusAction.textContent = t('Erneut versuchen');
        break;

      default:
        // idle: nothing newer exists, which on this screen is the good case
        // and deserves saying out loud rather than showing nothing.
        statusDot.dataset.state = 'current';
        statusTitle.textContent = t('SYNSA ist aktuell');
        statusSubtitle.textContent = state.currentVersion
          ? withVersion('Version {v} · keine weiteren Updates verfügbar.', state.currentVersion)
          : t('Keine weiteren Updates verfügbar.');
    }
  }

  // --- Changelog -------------------------------------------------------------

  // Rendered by shared/changelog.js, the same list the "Über SYNSA" section
  // in the settings shows.
  loadChangelog(changelogBox, { onlyCurrent: true });

  // --- Actions ---------------------------------------------------------------

  function postJSON(url) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })).catch(() => ({ ok: res.ok, data: null })))
      .catch(() => ({ ok: false, data: null }));
  }

  statusAction.addEventListener('click', () => {
    if (!currentState || actionBusy) return;

    const phase = currentState.phase;
    if (phase === 'available') {
      actionBusy = true;
      statusAction.disabled = true;
      postJSON('/api/update/accept').then(() => {
        actionBusy = false;
      });
      return;
    }

    if (phase === 'ready') {
      if (currentState.installBlocked) {
        statusSubtitle.textContent = t(BLOCKED_MESSAGE);
        return;
      }
      actionBusy = true;
      statusAction.disabled = true;
      postJSON('/api/update/install').then(({ ok, data }) => {
        actionBusy = false;
        if (!ok) {
          statusAction.disabled = false;
          statusSubtitle.textContent = t((data && data.message) || 'Installation nicht möglich.');
        }
      });
      return;
    }

    if (phase === 'error') {
      actionBusy = true;
      statusAction.disabled = true;
      postJSON('/api/update/retry').then(() => {
        actionBusy = false;
      });
    }
  });

  // "Weiter" records that this version has been acknowledged (so the screen
  // does not come back on every start) and then leaves for whichever page
  // actually makes sense: the Twitch setup while SYNSA is not configured yet,
  // the dashboard once it is. electron/main.js turns this navigation into the
  // full-size app window.
  continueBtn.addEventListener('click', async () => {
    continueBtn.disabled = true;
    await postJSON('/api/welcome/seen');

    let configured = false;
    try {
      const res = await fetch('/api/setup/status');
      if (res.ok) configured = Boolean((await res.json()).configured);
    } catch {
      // Treat an unreachable status as "not configured": sending someone to
      // the setup page they may not need is recoverable, a dashboard that
      // cannot work is not.
    }

    window.location.href = configured ? '/dashboard.html' : '/setup.html';
  });

  // --- State feed ------------------------------------------------------------

  // Same small, self-contained connection the update banner uses: this screen
  // is a standalone window and does not share a socket with any other page.
  let ws;
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.addEventListener('close', () => setTimeout(connect, 1500));
    ws.addEventListener('error', () => ws.close());
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.kind === 'state' && msg.state && msg.state.update) render(msg.state.update);
      if (msg.kind === 'update-status' && msg.status) render(msg.status);
    });
  }

  fetch('/api/update/status')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data) render(data);
    })
    .catch(() => {
      // The socket below catches up as soon as it connects.
    });

  connect();
})();
