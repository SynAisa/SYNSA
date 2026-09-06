// Shared "Twitch has to be linked again" banner. A page opts in with a single
// <div id="auth-banner"></div>, exactly like the update banner opts in with
// <div id="update-banner"></div> — and it deliberately renders with the same
// .update-banner* classes, so this is the existing banner component with
// different text rather than a second alert style to keep in sync.
//
// Purely a renderer: whether the authorization is gone is decided in
// twitch/eventsub.js (markAuthRevoked) and reaches every page as
// state.twitch.reauthRequired on the existing twitch-status broadcast. This
// script never asks Twitch anything and never touches stored tokens.
//
// Shown only for reauthRequired — an ordinary "not connected right now"
// (network blip, Twitch outage, still starting up) keeps reconnecting on its
// own and is none of this banner's business. There is no dismiss button: the
// state only ends when the user links SYNSA again.
(function () {
  const root = document.getElementById('auth-banner');
  if (!root) return;

  root.classList.add('update-banner', 'is-critical');
  root.hidden = true;
  root.innerHTML = `
    <div class="update-banner-main">
      <div class="update-banner-text">
        <strong>Twitch-Verbindung nicht mehr gültig</strong>
        <span>Alerts und Chat kommen nicht mehr an. Bitte verknüpfe SYNSA erneut mit Twitch.</span>
      </div>
      <div class="update-banner-actions">
        <a href="/setup.html" class="update-banner-primary">Neu verknüpfen</a>
      </div>
    </div>
  `;

  // Injected after shared/i18n.js walked the page, so this subtree gets its
  // own pass — same as the update banner.
  window.SynsaI18n.translateTree(root);

  function render(twitch) {
    root.hidden = !(twitch && twitch.reauthRequired);
  }

  // A small, independent WebSocket scoped to the Twitch status only, matching
  // shared/update-banner.js: this is a self-contained widget, not wired into
  // whatever WS handling the host page already does.
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
      if (msg.kind === 'state' && msg.state && msg.state.twitch) render(msg.state.twitch);
      if (msg.kind === 'twitch-status' && msg.status) render(msg.status);
    });
  }

  fetch('/api/twitch/status')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data) render(data);
    })
    .catch(() => {
      // The WS connection below will catch up once it opens.
    });

  connect();
})();
