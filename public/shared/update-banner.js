// Shared update banner, mounted into <div id="update-banner"></div> on both
// dashboard.html and settings.html. Purely a renderer: all update state
// (phase, release metadata, download progress, errors, whether the stream
// lock blocks installing) comes from the server's UpdateManager broadcasts
// — see update/manager.js. This script never decides anything about
// updates itself, only how to display what it's told.
(function () {
  const root = document.getElementById('update-banner');
  if (!root) return;

  const mainEl = document.getElementById('update-banner-main');
  const titleEl = document.getElementById('update-banner-title');
  const subtitleEl = document.getElementById('update-banner-subtitle');
  const notesBtn = document.getElementById('update-banner-notes-btn');
  const laterBtn = document.getElementById('update-banner-later-btn');
  const actionBtn = document.getElementById('update-banner-action-btn');
  const progressEl = document.getElementById('update-banner-progress');
  const progressFillEl = document.getElementById('update-banner-progress-fill');
  const progressLabelEl = document.getElementById('update-banner-progress-label');
  const notesEl = document.getElementById('update-banner-notes');
  const errorEl = document.getElementById('update-banner-error');
  const errorTextEl = document.getElementById('update-banner-error-text');
  const retryBtn = document.getElementById('update-banner-retry-btn');

  const BLOCKED_MESSAGE = 'Das Update kann während eines laufenden Streams nicht installiert werden.';

  let currentState = null;
  let notesOpen = false;

  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 140);
    }, 4000);
  }

  function postJSON(url) {
    return fetch(url, { method: 'POST' }).then(async (res) => ({
      ok: res.ok,
      data: await res.json().catch(() => null),
    }));
  }

  function formatMB(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }

  function render(state) {
    currentState = state;

    if (!state || !state.release) {
      root.hidden = true;
      return;
    }

    const { phase, release, download, error, installBlocked } = state;

    if (phase === 'idle' || phase === 'checking') {
      root.hidden = true;
      return;
    }

    if (phase === 'available' && state.dismissedForSession) {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    root.classList.toggle('is-critical', release.type === 'critical');

    // Release notes toggle + content is independent of phase.
    notesEl.hidden = !notesOpen;
    if (notesOpen) {
      notesEl.innerHTML = `<ul>${release.notes.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
    }

    errorEl.hidden = phase !== 'error';
    if (phase === 'error' && error) {
      errorTextEl.textContent = error.message;
    }

    progressEl.hidden = phase !== 'downloading';
    if (phase === 'downloading' && download) {
      progressFillEl.style.width = `${download.percent}%`;
      progressLabelEl.textContent = download.totalBytes
        ? `${formatMB(download.downloadedBytes)} / ${formatMB(download.totalBytes)} — ${download.percent}%`
        : `${download.percent}%`;
    }

    const titlePrefix = release.type === 'critical' ? 'Wichtiges Update' : `SYNSA ${release.version} verfügbar`;
    titleEl.textContent = titlePrefix;

    mainEl.hidden = phase === 'error';

    laterBtn.hidden = phase !== 'available';

    // Reset on every render; the install click handler is the only place
    // that sets this true, and it does so only for the brief window before
    // the next state broadcast (installing, or an error) arrives anyway.
    actionBtn.disabled = false;

    switch (phase) {
      case 'available':
        subtitleEl.textContent = 'Eine neue Version ist verfügbar.';
        actionBtn.hidden = false;
        actionBtn.textContent = 'Jetzt aktualisieren';
        actionBtn.classList.remove('is-blocked');
        actionBtn.title = '';
        break;
      case 'downloading':
        subtitleEl.textContent = `SYNSA ${release.version} wird heruntergeladen`;
        actionBtn.hidden = true;
        break;
      case 'ready':
        subtitleEl.textContent = 'Das Update wurde heruntergeladen.';
        actionBtn.hidden = false;
        actionBtn.textContent = 'Jetzt installieren';
        actionBtn.classList.toggle('is-blocked', installBlocked);
        actionBtn.title = installBlocked ? BLOCKED_MESSAGE : '';
        break;
      case 'installing':
        titleEl.textContent = 'SYNSA wird neu gestartet …';
        subtitleEl.textContent = 'Aktualisierung wird abgeschlossen. SYNSA wird gleich neu gestartet.';
        actionBtn.hidden = true;
        break;
      default:
        actionBtn.hidden = true;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  notesBtn.addEventListener('click', () => {
    notesOpen = !notesOpen;
    if (currentState) render(currentState);
  });

  laterBtn.addEventListener('click', () => postJSON('/api/update/dismiss'));

  // Guards the brief window between clicking "Jetzt installieren" and the
  // server's INSTALLING broadcast actually arriving and hiding the button
  // (see render()'s `actionBtn.hidden = true` for that phase) — without
  // this, a fast double-click could fire two /install requests before
  // either had a chance to update the UI. The server independently guards
  // the same thing (requestInstall() only accepts calls while phase is
  // READY), so this is a client-side courtesy, not the source of truth.
  let installRequested = false;

  actionBtn.addEventListener('click', () => {
    if (!currentState) return;

    if (currentState.phase === 'available') {
      postJSON('/api/update/accept');
      return;
    }

    if (currentState.phase === 'ready') {
      if (currentState.installBlocked) {
        showToast(BLOCKED_MESSAGE);
        return;
      }
      if (installRequested) return;
      installRequested = true;
      actionBtn.disabled = true;
      postJSON('/api/update/install').then(({ ok, data }) => {
        if (!ok) {
          installRequested = false;
          actionBtn.disabled = false;
          showToast((data && data.message) || 'Installation nicht möglich.');
        }
      });
    }
  });

  retryBtn.addEventListener('click', () => postJSON('/api/update/retry'));

  // A small, independent WebSocket connection scoped to update/stream
  // status only — this banner is a self-contained widget (like the module
  // menu), not wired into whatever WS handling the host page already has.
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
      if (msg.kind === 'state' && msg.state && msg.state.update) {
        render(msg.state.update);
      }
      if (msg.kind === 'update-status' && msg.status) {
        render(msg.status);
      }
    });
  }

  fetch('/api/update/status')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data) render(data);
    })
    .catch(() => {
      // The WS connection below will catch up once it opens.
    });

  connect();
})();
