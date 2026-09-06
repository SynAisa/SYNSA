// Diagnostics page — renders whatever GET /api/diagnostics reports and
// nothing else. No controls: this page never sends a command, never changes
// state, and has no side effects beyond its own polling.
//
// Polls rather than listening for broadcasts: overlay presence (a Browser
// Source appearing or disappearing as OBS switches scenes) is not broadcast,
// and adding a broadcast for it would put load on every page for something
// only this one cares about. The page socket is still used, for the standard
// shared local-connection warning used by ordinary pages.
(function () {
  const REFRESH_MS = 5000;

  const twitchEl = document.getElementById('diag-twitch');
  const overlaysEl = document.getElementById('diag-overlays');
  const musicEl = document.getElementById('diag-music');
  const updateEl = document.getElementById('diag-update');
  const serverEl = document.getElementById('diag-server');
  const footerEl = document.getElementById('diag-footer');

  // Longer-form than the dashboard's chat timestamps ("vor 3m"): this reads as
  // a sentence about a Browser Source somebody is trying to find, not as a
  // label squeezed next to a chat line.
  // Singular and plural are separate keys: "vor 1 Minuten" is wrong German,
  // and English needs the same split ("1 minute ago").
  function ago(n, singular, plural) {
    return n === 1 ? t(singular) : t(plural).replace('{n}', n);
  }

  function sinceText(timestamp) {
    const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (sec < 10) return t('gerade eben');
    if (sec < 60) return ago(sec, 'vor 1 Sekunde', 'vor {n} Sekunden');
    const min = Math.floor(sec / 60);
    if (min < 60) return ago(min, 'vor 1 Minute', 'vor {n} Minuten');
    const hours = Math.floor(min / 60);
    if (hours < 24) return ago(hours, 'vor 1 Stunde', 'vor {n} Stunden');
    return ago(Math.floor(hours / 24), 'vor 1 Tag', 'vor {n} Tagen');
  }

  // tone: 'ok' | 'problem' | 'neutral' | null (plain)
  function row(parent, label, value, tone, options = {}) {
    const el = document.createElement('div');
    el.className = options.compact ? 'diag-row is-compact' : 'diag-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'diag-label';
    labelEl.textContent = label;
    el.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'diag-value';
    if (tone) valueEl.classList.add(`is-${tone}`);
    valueEl.textContent = value;
    el.appendChild(valueEl);

    parent.appendChild(el);
    return el;
  }

  function note(parent, text, tone) {
    const el = document.createElement('div');
    el.className = tone ? `diag-note is-${tone}` : 'diag-note';
    el.textContent = text;
    parent.appendChild(el);
  }

  function subhead(parent, text) {
    const el = document.createElement('div');
    el.className = 'diag-subhead';
    el.textContent = text;
    parent.appendChild(el);
  }

  function renderTwitch(data) {
    twitchEl.replaceChildren();

    row(
      twitchEl,
      t('Verbindung'),
      data.connected ? t('Verbunden') : t('Nicht verbunden'),
      data.connected ? 'ok' : 'problem'
    );
    row(twitchEl, t('Kanal'), data.channel || '—', data.channel ? null : 'neutral');

    if (data.reauthRequired) {
      note(twitchEl, t('Twitch hat den Zugriff abgelehnt — SYNSA muss neu verknüpft werden.'), 'problem');
    }

    subhead(twitchEl, t('EventSub-Subscriptions'));
    data.subscriptions.forEach((sub) => {
      const label = sub.ok === null ? t('Keine Verbindung') : sub.ok ? t('OK') : t('Fehlgeschlagen');
      const tone = sub.ok === null ? 'neutral' : sub.ok ? 'ok' : 'problem';
      row(twitchEl, sub.type, label, tone, { compact: true });
      if (sub.message) note(twitchEl, sub.message, 'problem');
    });
  }

  function renderOverlay(parent, label, overlay) {
    if (overlay.connected) {
      const value = overlay.count > 1 ? t('Verbunden ({n})').replace('{n}', overlay.count) : t('Verbunden');
      row(parent, label, value, 'ok');
    } else if (overlay.lastSeenAt) {
      row(parent, label, t('Gerade nicht sichtbar'), 'neutral');
      note(parent, `${t('Zuletzt gesehen')}: ${sinceText(overlay.lastSeenAt)}`);
    } else {
      // Neutral, not a warning: not everyone uses every overlay, and painting
      // an unused one amber would cry wolf on a page meant for real problems.
      row(parent, label, t('Noch nie verbunden'), 'neutral');
      note(parent, t('Diese Browser Source ist in OBS noch nicht eingerichtet.'));
    }

    // Only the alert overlay knows a primary — it owns the sound and the queue
    // status, so with more than one open it matters which.
    const primaries = overlay.instances.filter((i) => i.primary === true);
    if (overlay.count > 1 && primaries.length) {
      note(parent, `${t('Primär (Ton + Warteschlange)')}: ${primaries[0].id}`);
    }
  }

  function renderOverlays(data) {
    overlaysEl.replaceChildren();
    renderOverlay(overlaysEl, t('Alert-Overlay'), data.alert);
    renderOverlay(overlaysEl, t('Music-Overlay'), data.music);
    renderOverlay(overlaysEl, t('Countdown-Overlay'), data.countdown);
    renderOverlay(overlaysEl, t('Ziel-Overlay'), data.goal);
  }

  function renderMusic(data) {
    musicEl.replaceChildren();
    row(
      musicEl,
      t('YTMDesktop gekoppelt'),
      data.paired ? t('Ja') : t('Nein'),
      data.paired ? 'ok' : 'neutral'
    );
    row(
      musicEl,
      t('Verbindung'),
      data.connected ? t('Verbunden') : t('Nicht verbunden'),
      data.connected ? 'ok' : data.paired ? 'problem' : 'neutral'
    );
    if (data.paired && !data.connected) {
      note(musicEl, t('Gekoppelt, aber keine Verbindung — läuft die YouTube-Music-App?'), 'problem');
    }
  }

  const UPDATE_PHASES = {
    idle: 'Aktuell',
    checking: 'Suche läuft',
    available: 'Update verfügbar',
    downloading: 'Wird heruntergeladen',
    ready: 'Bereit zur Installation',
    installing: 'Wird installiert',
    error: 'Fehler',
  };

  function renderUpdate(data) {
    updateEl.replaceChildren();
    row(updateEl, t('Installierte Version'), data.currentVersion || '—');
    row(
      updateEl,
      t('Status'),
      t(UPDATE_PHASES[data.phase] || data.phase),
      data.phase === 'error' ? 'problem' : data.phase === 'idle' ? 'ok' : 'neutral'
    );
    if (data.availableVersion) {
      row(updateEl, t('Verfügbare Version'), data.availableVersion, 'neutral');
    }
  }

  function renderServer(data) {
    serverEl.replaceChildren();
    row(serverEl, t('Port'), String(data.port));

    // A source that cannot reach SYNSA while another one can is almost always
    // a half-bound port: "localhost" resolves to ::1 first on Windows.
    ['127.0.0.1', '::1'].forEach((host) => {
      const bound = data.boundHosts.includes(host);
      row(serverEl, host, bound ? t('Gebunden') : t('Nicht gebunden'), bound ? 'ok' : 'problem', {
        compact: true,
      });
      const failure = data.failedHosts.find((f) => f.host === host);
      if (failure) note(serverEl, failure.message, 'problem');
    });

    if (data.startedAt) {
      row(serverEl, t('Gestartet'), sinceText(data.startedAt), 'neutral');
    }
  }

  function render(data) {
    renderTwitch(data.twitch);
    renderOverlays(data.overlays);
    renderMusic(data.music);
    renderUpdate(data.update);
    renderServer(data.server);
    footerEl.textContent = `SYNSA v${data.version} · ${t('Stand')}: ${new Date(data.generatedAt).toLocaleTimeString()}`;
  }

  function load() {
    fetch('/api/diagnostics')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) render(data);
      })
      .catch(() => {
        // The next poll will pick it up; leaving the last snapshot on screen
        // beats blanking the page the moment SYNSA restarts.
      });
  }

  load();
  setInterval(load, REFRESH_MS);

  // Keeps the shared local-connection warning active if the server goes away;
  // this page reads its actual diagnostics data over HTTP.
  window.connectPageSocket(() => {});
})();
