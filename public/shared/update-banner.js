// Shared update banner. A page opts in with a single
// <div id="update-banner"></div>; the markup below is built here rather than
// repeated in every page's HTML, which is how it used to be — seventeen
// identical lines in dashboard.html, settings.html and setup.html that all
// had to be edited together whenever the banner changed.
//
// Purely a renderer: all update state (phase, release metadata, download
// progress, errors, whether the stream lock blocks installing) comes from
// the server's UpdateManager broadcasts — see update/manager.js. This script
// never decides anything about updates itself, only how to display what it's
// told.
(function () {
  const root = document.getElementById('update-banner');
  if (!root) return;

  root.classList.add('update-banner');
  root.hidden = true;
  root.innerHTML = `
    <div id="update-banner-main" class="update-banner-main">
      <div class="update-banner-text">
        <strong id="update-banner-title"></strong>
        <span id="update-banner-subtitle"></span>
      </div>
      <div class="update-banner-actions">
        <button type="button" id="update-banner-notes-btn" class="update-banner-link">Änderungen anzeigen</button>
        <button type="button" id="update-banner-later-btn" class="update-banner-link">Später</button>
        <button type="button" id="update-banner-action-btn" class="update-banner-primary"></button>
      </div>
    </div>
    <div id="update-banner-progress" class="update-banner-progress" hidden>
      <div class="update-banner-progress-track"><div id="update-banner-progress-fill" class="update-banner-progress-fill"></div></div>
      <span id="update-banner-progress-label" class="update-banner-progress-label"></span>
    </div>
    <div id="update-banner-notes" class="update-banner-notes" hidden></div>
    <div id="update-banner-error" class="update-banner-error" hidden>
      <span id="update-banner-error-text"></span>
      <button type="button" id="update-banner-retry-btn">Erneut versuchen</button>
    </div>
  `;

  // Injected after shared/i18n.js walked the page, so this subtree gets its
  // own pass.
  window.SynsaI18n.translateTree(root);

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

  const { showToast } = window.SynsaUI;

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
      errorTextEl.textContent = t(error.message);
    }

    progressEl.hidden = phase !== 'downloading';
    if (phase === 'downloading' && download) {
      progressFillEl.style.width = `${download.percent}%`;
      progressLabelEl.textContent = download.totalBytes
        ? `${formatMB(download.downloadedBytes)} / ${formatMB(download.totalBytes)} — ${download.percent}%`
        : `${download.percent}%`;
    }

    const titlePrefix =
      release.type === 'critical' ? t('Wichtiges Update') : t('SYNSA {v} verfügbar').replace('{v}', release.version);
    titleEl.textContent = titlePrefix;

    mainEl.hidden = phase === 'error';

    laterBtn.hidden = phase !== 'available';

    // Reset on every render; the install click handler is the only place
    // that sets this true, and it does so only for the brief window before
    // the next state broadcast (installing, or an error) arrives anyway.
    actionBtn.disabled = false;

    switch (phase) {
      case 'available':
        subtitleEl.textContent = t('Eine neue Version ist verfügbar.');
        actionBtn.hidden = false;
        actionBtn.textContent = t('Jetzt aktualisieren');
        actionBtn.classList.remove('is-blocked');
        actionBtn.title = '';
        break;
      case 'downloading':
        subtitleEl.textContent = t('SYNSA {v} wird heruntergeladen').replace('{v}', release.version);
        actionBtn.hidden = true;
        break;
      case 'ready':
        subtitleEl.textContent = t('Das Update wurde heruntergeladen.');
        actionBtn.hidden = false;
        actionBtn.textContent = t('Jetzt installieren');
        actionBtn.classList.toggle('is-blocked', installBlocked);
        actionBtn.title = installBlocked ? t(BLOCKED_MESSAGE) : '';
        break;
      case 'installing':
        titleEl.textContent = t('SYNSA wird neu gestartet …');
        subtitleEl.textContent = t('Aktualisierung wird abgeschlossen. SYNSA wird gleich neu gestartet.');
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
        showToast(t(BLOCKED_MESSAGE));
        return;
      }
      if (installRequested) return;
      installRequested = true;
      actionBtn.disabled = true;
      postJSON('/api/update/install').then(({ ok, data }) => {
        if (!ok) {
          installRequested = false;
          actionBtn.disabled = false;
          showToast(t((data && data.message) || 'Installation nicht möglich.'));
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
