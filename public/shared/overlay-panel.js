// The two blocks every overlay settings page shows about its own Browser
// Source: the URL to paste into OBS with a copy button and a live connection
// status, and an embedded preview of the overlay itself.
//
// A page opts in with two mount points:
//   <div id="overlay-header" data-role="music" data-path="/overlay-music.html"></div>
//   <div id="overlay-preview"></div>
// The role is the key the server tracks presence under (see overlayPresence
// in server.js); the path is the page that goes into OBS.
//
// The preview is a plain <iframe> pointing at that same page — not a
// reimplementation of it. It connects to the same WebSocket and receives the
// same state broadcasts, so what it shows is literally the overlay, just
// embedded instead of in OBS.
(function () {
  const header = document.getElementById('overlay-header');
  if (!header) return;

  const role = header.dataset.role;
  const path = header.dataset.path;
  const url = `${location.origin}${path}`;

  // Same interval as the diagnostics page, and for the same reason: overlay
  // presence is not broadcast (an OBS scene switch is nobody else's business),
  // and adding a broadcast for it would put load on every open page for
  // something only these few care about.
  const STATUS_POLL_MS = 5000;

  header.className = 'overlay-header';
  header.innerHTML = `
    <div class="overlay-header-label">Overlay-URL für OBS</div>
    <div class="overlay-header-row">
      <input type="text" class="overlay-url-input" id="overlay-url-input" readonly spellcheck="false">
      <button type="button" class="overlay-url-copy" id="overlay-url-copy">Kopieren</button>
      <span class="overlay-status-chip" id="overlay-status-chip"></span>
    </div>
    <div class="overlay-header-note" id="overlay-status-note"></div>
  `;

  const urlInput = document.getElementById('overlay-url-input');
  const copyBtn = document.getElementById('overlay-url-copy');
  const chipEl = document.getElementById('overlay-status-chip');
  const noteEl = document.getElementById('overlay-status-note');

  urlInput.value = url;

  const preview = document.getElementById('overlay-preview');
  if (preview) {
    preview.className = 'overlay-preview';
    preview.innerHTML = `
      <div class="overlay-preview-title">Vorschau</div>
      <div class="overlay-preview-frame">
        <iframe src="${url}?preview=1" title="Overlay-Vorschau" loading="lazy"></iframe>
      </div>
      <p class="overlay-preview-note">Das ist die echte Overlay-Seite, eingebettet — sie zeigt live denselben Stand wie in OBS.</p>
    `;
  }

  // Injected after shared/i18n.js walked the page, so these subtrees get
  // their own pass.
  window.SynsaI18n.translateTree(header);
  if (preview) window.SynsaI18n.translateTree(preview);

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard permission denied — selecting the text is still a way out.
      urlInput.select();
      return;
    }
    const original = copyBtn.textContent;
    copyBtn.textContent = t('Kopiert');
    copyBtn.classList.add('is-copied');
    setTimeout(() => {
      copyBtn.textContent = original;
      copyBtn.classList.remove('is-copied');
    }, 1600);
  });

  function sinceText(timestamp) {
    const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (sec < 10) return t('gerade eben');
    if (sec < 60) return sec === 1 ? t('vor 1 Sekunde') : t('vor {n} Sekunden').replace('{n}', sec);
    const min = Math.floor(sec / 60);
    if (min < 60) return min === 1 ? t('vor 1 Minute') : t('vor {n} Minuten').replace('{n}', min);
    const hours = Math.floor(min / 60);
    if (hours < 24) return hours === 1 ? t('vor 1 Stunde') : t('vor {n} Stunden').replace('{n}', hours);
    const days = Math.floor(hours / 24);
    return days === 1 ? t('vor 1 Tag') : t('vor {n} Tagen').replace('{n}', days);
  }

  function render(status) {
    if (!status) return;

    chipEl.classList.toggle('is-connected', Boolean(status.connected));

    if (status.connected) {
      chipEl.textContent = status.count > 1
        ? t('In OBS verbunden ({n})').replace('{n}', status.count)
        : t('In OBS verbunden');
      noteEl.textContent = '';
      return;
    }

    chipEl.textContent = t('Nicht verbunden');
    noteEl.textContent = status.lastSeenAt
      ? `${t('Zuletzt gesehen')}: ${sinceText(status.lastSeenAt)}`
      : t('Diese Browser Source ist in OBS noch nicht eingerichtet.');
  }

  function load() {
    fetch(`/api/overlay-status/${encodeURIComponent(role)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(render)
      .catch(() => {
        // The next poll picks it up; leaving the last value on screen beats
        // blanking it the moment SYNSA restarts.
      });
  }

  load();
  setInterval(load, STATUS_POLL_MS);
})();
