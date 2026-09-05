(function () {
  const DISPLAY_MS = 5500;
  const EXIT_MS = 420;
  // A resub/cheer message can run up to Twitch's 500-char chat limit —
  // give viewers real reading time for longer ones instead of the fixed
  // 5.5s, without letting one long message hold up the whole queue.
  const MS_PER_EXTRA_CHAR = 45;
  const MESSAGE_FREE_CHARS = 40; // roughly what the base DISPLAY_MS already covers
  const MAX_DISPLAY_MS = 14000;

  // A gift-sub bomb can hand us hundreds of alerts at once. At full length
  // that is an hour of backlog during which nothing current gets shown, so
  // the queue is both capped and drained faster the deeper it gets.
  const MAX_QUEUE = 15;
  const MIN_DISPLAY_MS = 2200;

  const card = document.getElementById('alert-card');
  const typeEl = card.querySelector('.alert-type');
  const userEl = card.querySelector('.alert-username');
  const detailEl = card.querySelector('.alert-detail');
  const iconSlot = card.querySelector('.icon-slot');

  const queue = [];
  let showing = false;
  let ws = null;
  // Assume primary: a single overlay is the normal case, and the server
  // corrects us right after register if another one got there first.
  let isPrimary = true;
  // Replay (see the server's redelivery window) can hand us an alert we
  // already have if an ack went missing mid-reconnect.
  const seenIds = new Set();

  function enqueue(item) {
    if (item.id) {
      if (seenIds.has(item.id)) return;
      seenIds.add(item.id);
      // The id set only exists to reject replays inside the redelivery
      // window, so it never needs to grow past the queue it guards.
      if (seenIds.size > 200) {
        seenIds.delete(seenIds.values().next().value);
      }
    }

    queue.push(item);

    // Overflow drops the oldest waiting alerts: by the time a backlog is
    // this deep they are minutes stale, and showing the newest is closer
    // to what is actually happening on stream right now.
    while (queue.length > MAX_QUEUE) {
      const dropped = queue.shift();
      reportStatus(dropped.id, 'done');
    }

    processQueue();
  }

  function processQueue() {
    if (showing || queue.length === 0) return;
    showing = true;

    const item = queue.shift();
    renderAlert(item.alert);
    card.hidden = false;
    if (isPrimary) window.AlertSounds.play(item.alert.type, item.alert.data);
    reportStatus(item.id, 'playing');

    requestAnimationFrame(() => {
      card.classList.add('is-visible');
    });

    setTimeout(() => {
      card.classList.add('is-leaving');
      setTimeout(() => {
        card.classList.remove('is-visible', 'is-leaving');
        card.hidden = true;
        showing = false;
        reportStatus(item.id, 'done');
        processQueue();
      }, EXIT_MS);
    }, displayDurationFor(item.alert));
  }

  function displayDurationFor(alert) {
    const message = alert.data && alert.data.message;
    let ms = DISPLAY_MS;

    if (message) {
      const extraChars = Math.max(0, message.length - MESSAGE_FREE_CHARS);
      ms = Math.min(MAX_DISPLAY_MS, DISPLAY_MS + extraChars * MS_PER_EXTRA_CHAR);
    }

    // Deeper backlog -> shorter time on screen, down to a floor that is
    // still readable.
    if (queue.length > 2) {
      ms = Math.max(MIN_DISPLAY_MS, ms * Math.max(0.4, 1 - queue.length * 0.06));
    }

    return ms;
  }

  // Lets the dashboard's Verlauf panel show which entry is currently
  // live vs still waiting — the overlay is the only thing that actually
  // knows this, since it owns the queue and its timing.
  // Secondary overlays stay silent here too — otherwise two of them report
  // conflicting playing/done for the same alert and the dashboard flickers.
  function reportStatus(id, status) {
    if (!id || !isPrimary || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ kind: 'alert-status', id, status }));
  }

  // Tells the server the alert is safely in our queue, so it stops holding
  // it for redelivery. Sent on receipt rather than on display: it is about
  // having it, not about having shown it yet.
  function acknowledge(id) {
    if (!id || !isPrimary || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ kind: 'alert-ack', id }));
  }

  function renderAlert(alert) {
    const config = window.ALERT_TYPES[alert.type] || {};
    const data = alert.data || {};

    typeEl.textContent = data.isGift && config.giftLabel ? config.giftLabel : (config.label || alert.type);
    iconSlot.innerHTML = config.icon || '';
    userEl.textContent = data.username || 'Anonymous';
    // Unlike the dashboard's Verlauf (truncated, with a hover tooltip for
    // the rest), the stream-facing card writes the whole message out —
    // nobody watching can hover to reveal more.
    detailEl.textContent = window.buildAlertDetail(alert.type, data, { truncate: false });
  }

  // This source sits in OBS for the whole stream, so when the app is closed
  // it would otherwise retry twice a second indefinitely. Backing off keeps
  // a fast first retry for the common blip and goes quiet after that.
  let retryDelay = 1500;

  function nextRetryDelay() {
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, 30000);
    return delay;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => {
      retryDelay = 1500;
      ws.send(JSON.stringify({ kind: 'register', role: 'overlay' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.kind === 'alert' && msg.alert) {
          acknowledge(msg.id);
          enqueue({ id: msg.id, alert: msg.alert });
        }
        if (msg.kind === 'overlay-role') isPrimary = Boolean(msg.primary);
        if (msg.kind === 'state' && msg.state) window.AlertSounds.setVolume(msg.state.volume);
        if (msg.kind === 'volume') window.AlertSounds.setVolume(msg.volume);
      } catch {
        // ignore malformed messages
      }
    });

    ws.addEventListener('close', () => setTimeout(connect, nextRetryDelay()));
    ws.addEventListener('error', () => ws.close());
  }

  connect();

  if (!navigator.userAgent.includes('OBS')) {
    document.body.classList.add('preview-mode');

    // OBS's Browser Source allows audio autoplay without a user gesture;
    // a normal browser tab does not, so offer a one-click unlock here.
    const unlockBtn = document.getElementById('sound-unlock');
    unlockBtn.hidden = false;
    unlockBtn.addEventListener('click', () => {
      window.AlertSounds.unlock().then(() => {
        unlockBtn.hidden = true;
      });
    });
  }
})();
