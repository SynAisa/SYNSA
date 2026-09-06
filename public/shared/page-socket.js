// The WebSocket connection every settings/dashboard page keeps to the local
// server, plus the "Verbunden / Getrennt" line in its header.
//
// This was the same twenty lines copied into five pages — identical down to
// the reconnect delay and the status text — so a fix or a change had to be
// made five times to stay consistent. The message handling is the only part
// that ever actually differed, and that is what each page passes in.
//
// Deliberately NOT used by the overlay pages: those reconnect with a growing
// backoff instead of a flat delay, because an OBS browser source can sit
// disconnected for a long time, and they have no status line to update. Their
// connection logic stays where it is.
(function () {
  const RECONNECT_MS = 1500;

  // onMessage receives the already-parsed message object.
  // Returns { send, isOpen } — send() JSON-encodes and only writes on an open
  // socket, which is exactly the guard every call site used to repeat.
  window.connectPageSocket = function connectPageSocket(onMessage) {
    const statusEl = document.getElementById('status');
    let ws = null;

    // Named "SYNSA", not just "Verbunden": this is the page's live connection
    // to SYNSA's own local server, and it sat right above a *Twitch* status
    // saying "Verbunden as well" on the control panel. Two different things
    // reading the same word in the same window is a question waiting to be
    // asked, and it was.
    function setStatus(connected) {
      if (!statusEl) return;
      statusEl.textContent = t(connected ? 'SYNSA verbunden' : 'SYNSA getrennt – neuer Versuch …');
      statusEl.title = connected
        ? t('Diese Seite ist mit SYNSA verbunden und wird live aktualisiert. Sagt nichts über die Twitch-Verbindung aus.')
        : t('Diese Seite hat gerade keine Verbindung zu SYNSA und zeigt womöglich veraltete Werte. Sagt nichts über die Twitch-Verbindung aus.');
      statusEl.classList.toggle('is-connected', connected);
    }

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}`);

      ws.addEventListener('open', () => setStatus(true));
      ws.addEventListener('close', () => {
        setStatus(false);
        setTimeout(connect, RECONNECT_MS);
      });
      ws.addEventListener('error', () => ws.close());
      ws.addEventListener('message', (event) => {
        // Parsing and dispatching share one try/catch because that is how all
        // five pages behaved before: a malformed message, or a handler that
        // throws on one, is ignored rather than tearing down the listener.
        try {
          if (onMessage) onMessage(JSON.parse(event.data));
        } catch {
          // ignore malformed messages
        }
      });
    }

    connect();

    return {
      send(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(payload));
        return true;
      },
      isOpen() {
        return Boolean(ws) && ws.readyState === WebSocket.OPEN;
      },
    };
  };
})();
