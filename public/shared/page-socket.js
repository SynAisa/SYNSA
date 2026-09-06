// The WebSocket connection every settings/dashboard page keeps to the local
// server. A healthy local connection stays deliberately invisible; only a
// lost connection needs to interrupt the page with a clear warning.
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
    let warningEl = document.getElementById('local-connection-warning');
    if (!warningEl) {
      warningEl = document.createElement('div');
      warningEl.id = 'local-connection-warning';
      warningEl.className = 'local-connection-warning';
      warningEl.hidden = true;
      const page = document.querySelector('.page');
      if (page) page.prepend(warningEl);
    }
    let ws = null;

    function setStatus(connected) {
      if (!warningEl) return;
      warningEl.hidden = connected;
      if (!connected) warningEl.textContent = t('Die Verbindung zur lokalen SYNSA-App wurde unterbrochen. Neuer Versuch …');
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
