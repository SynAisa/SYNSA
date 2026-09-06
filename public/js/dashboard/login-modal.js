// First-run Twitch login lives over the dashboard rather than in a separate
// setup window. The actual Device Code flow remains server-owned, so approval
// in the browser can finish safely even if this modal is closed later.
(function () {
  const forceOpen = new URLSearchParams(location.search).get('login') === '1';
  // Settings is an intentional reconnect action, not a first start. It goes
  // straight to the permission explanation instead of greeting the person a
  // second time.
  const startAtPermissions = new URLSearchParams(location.search).get('step') === 'permissions';
  let overlay;
  let card;
  let pollTimer = null;
  let state = 'welcome';
  let resolveReady;
  // The first-run dashboard tour waits for this promise. Otherwise it can
  // start behind this modal, be invisible to a new user and still count as
  // their first tour.
  window.SynsaLoginModalReady = new Promise((resolve) => { resolveReady = resolve; });

  function markReady() {
    if (resolveReady) {
      resolveReady();
      resolveReady = null;
    }
  }

  function clearLoginQuery() {
    if (!forceOpen) return;
    const url = new URL(location.href);
    url.searchParams.delete('login');
    url.searchParams.delete('step');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function postUiState(patch) {
    return fetch('/api/ui-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
  }

  function close() {
    clearInterval(pollTimer);
    pollTimer = null;
    if (overlay) overlay.remove();
    if (card) card.remove();
    overlay = null;
    card = null;
    clearLoginQuery();
    markReady();
  }

  function connectLater() {
    postUiState({ loginDismissed: true });
    close();
  }

  function button(text, className, onClick) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `login-modal-btn ${className}`;
    element.textContent = t(text);
    element.addEventListener('click', onClick);
    return element;
  }

  function actions(...buttons) {
    const row = document.createElement('div');
    row.className = 'login-modal-actions';
    buttons.forEach((element) => row.appendChild(element));
    return row;
  }

  function renderWelcome() {
    state = 'welcome';
    card.replaceChildren();
    const eyebrow = document.createElement('span');
    eyebrow.className = 'login-modal-eyebrow';
    eyebrow.textContent = t('Willkommen bei SYNSA');
    const title = document.createElement('h2');
    title.textContent = t('Dein Stream, übersichtlich an einem Ort.');
    const text = document.createElement('p');
    text.textContent = t('SYNSA bündelt Alerts, Chat und Streaminfos an einem Ort.');
    const changes = document.createElement('div');
    changes.className = 'login-changelog';
    const changesTitle = document.createElement('strong'); changesTitle.textContent = t('Das Wichtigste in dieser Version');
    const changesBox = document.createElement('div'); changesBox.className = 'changelog-box';
    changesBox.textContent = t('Wird geladen …');
    changes.append(changesTitle, changesBox);
    card.append(eyebrow, title, text, changes, actions(button('Los geht’s', 'login-modal-btn-primary', renderPermissions)));
    if (window.loadChangelog) window.loadChangelog(changesBox, { onlyCurrent: true });
  }

  function renderPermissions() {
    state = 'permissions';
    card.replaceChildren();
    const eyebrow = document.createElement('span');
    eyebrow.className = 'login-modal-eyebrow';
    eyebrow.textContent = t('Twitch-Verbindung');
    const title = document.createElement('h2');
    title.textContent = t('Diese Rechte benötigt SYNSA');
    const lead = document.createElement('p');
    lead.textContent = t('Twitch zeigt dir diese Berechtigungen gleich noch einmal. SYNSA verwendet sie nur für diese Funktionen:');
    const list = document.createElement('ul');
    list.className = 'login-permissions';
    [
      ['Alerts', 'Neue Follower, Abos, Geschenk-Abos und Bits erkennen.'],
      ['Chat', 'Chat anzeigen, Nachrichten senden und Emotes bereitstellen.'],
      ['Moderation', 'Timeouts und Bans aus dem Dashboard ausführen.'],
      ['Streaminfos', 'Titel und Kategorie deines Streams ändern.'],
    ].forEach(([name, description]) => {
      const item = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = t(name);
      item.append(strong, ` — ${t(description)}`);
      list.appendChild(item);
    });
    const note = document.createElement('p');
    note.className = 'login-modal-note';
    note.textContent = t('Deine Zugangsdaten bleiben verschlüsselt auf diesem PC. Du kannst die Verbindung später in den Einstellungen trennen.');
    card.append(eyebrow, title, lead, list, note, actions(
      button('Ich verbinde mich später', 'login-modal-btn-secondary', connectLater),
      button('Ich habe verstanden', 'login-modal-btn-primary', startDeviceFlow),
    ));
  }

  function renderWaiting(device) {
    state = 'waiting';
    card.replaceChildren();
    const eyebrow = document.createElement('span');
    eyebrow.className = 'login-modal-eyebrow';
    eyebrow.textContent = t('Twitch-Verbindung');
    const title = document.createElement('h2');
    title.textContent = t('Bestätige die Anmeldung bei Twitch');
    const text = document.createElement('p');
    text.textContent = t('Twitch wurde in deinem normalen Browser geöffnet. Vergleiche dort den folgenden Code und bestätige die angezeigten Rechte.');
    const codeLabel = document.createElement('span');
    codeLabel.className = 'login-modal-code-label';
    codeLabel.textContent = t('Abgleichcode');
    const code = document.createElement('div');
    code.className = 'login-device-code';
    code.textContent = device.userCode || '––––––';
    const open = document.createElement('a');
    open.className = 'login-device-open';
    open.href = device.verificationUri || '#';
    open.target = '_blank';
    open.rel = 'noreferrer';
    open.textContent = t('Twitch-Seite öffnen');
    const cancel = button('Abbrechen', 'login-modal-btn-secondary', cancelDeviceFlow);
    card.append(eyebrow, title, text, codeLabel, code, actions(cancel, open));
  }

  function renderError(message) {
    renderPermissions();
    const error = document.createElement('p');
    error.className = 'login-modal-error';
    error.textContent = message || t('Twitch ist gerade nicht erreichbar. Bitte versuche es später erneut.');
    card.insertBefore(error, card.lastElementChild);
  }

  async function startDeviceFlow() {
    try {
      const response = await fetch('/api/twitch/device/start', { method: 'POST' });
      const device = await response.json();
      if (device.status === 'waiting') {
        window.open(device.verificationUri, '_blank', 'noopener');
        renderWaiting(device);
        startPolling();
      } else renderError(device.error);
    } catch {
      renderError();
    }
  }

  async function cancelDeviceFlow() {
    clearInterval(pollTimer);
    pollTimer = null;
    try { await fetch('/api/twitch/device/cancel', { method: 'POST' }); } catch {}
    renderPermissions();
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const response = await fetch('/api/twitch/device/status');
        const device = await response.json();
        if (device.status === 'connected') {
          postUiState({ loginDismissed: true });
          close();
        } else if (device.status !== 'waiting') {
          clearInterval(pollTimer);
          pollTimer = null;
          renderError(device.error);
        }
      } catch {
        // A temporary local request failure must not cancel an approval that
        // is still running independently on the server.
      }
    }, 2000);
  }

  function open() {
    overlay = document.createElement('div');
    overlay.className = 'login-modal-overlay';
    card = document.createElement('section');
    card.className = 'login-modal';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    document.body.append(overlay, card);
    if (startAtPermissions) renderPermissions();
    else renderWelcome();
    card.querySelector('button')?.focus();
  }

  Promise.all([
    fetch('/api/setup/status').then((response) => response.ok ? response.json() : null),
    fetch('/api/ui-state').then((response) => response.ok ? response.json() : null),
    fetch('/api/twitch/device/status').then((response) => response.ok ? response.json() : null),
  ]).then(([setup, uiState, device]) => {
    if (!setup || setup.connected) {
      markReady();
      return;
    }
    if (!forceOpen && uiState && uiState.loginDismissed) {
      markReady();
      return;
    }
    open();
    if (device && device.status === 'waiting') {
      renderWaiting(device);
      startPolling();
    }
  }).catch(() => {
    // Dashboard remains usable when the local server is unavailable; the
    // ordinary page-socket warning explains the outage.
    markReady();
  });
})();
