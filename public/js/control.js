(function () {
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('event-log');

  const randomNames = [
    'nova_stream', 'pixelfox', 'glitchwave', 'moonrider', 'kaiden_tv',
    'echoplex', 'brightsignal', 'saltybard', 'quietstorm', 'ironwillow',
  ];
  const randomName = () => randomNames[Math.floor(Math.random() * randomNames.length)];

  const volumeSlider = document.getElementById('volume-slider');
  const volumeValue = document.getElementById('volume-value');

  const twitchStatusEl = document.getElementById('twitch-status');
  const twitchConnectLink = document.getElementById('twitch-connect');
  const twitchDisconnectForm = document.getElementById('twitch-disconnect-form');
  const twitchSessionEl = document.getElementById('twitch-session');
  const twitchSessionRevealEl = document.getElementById('twitch-session-reveal');

  let ws;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.addEventListener('open', () => setStatus(true));
    ws.addEventListener('close', () => {
      setStatus(false);
      setTimeout(connect, 1500);
    });
    ws.addEventListener('error', () => ws.close());
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.kind === 'state' && msg.state) {
          applyVolume(msg.state.volume, false);
          applyTwitchStatus(msg.state.twitch);
        }
        if (msg.kind === 'volume') applyVolume(msg.volume, false);
        if (msg.kind === 'twitch-status') applyTwitchStatus(msg.status);
      } catch {
        // ignore malformed messages
      }
    });
  }

  function applyVolume(volume, send) {
    const percent = Math.round(volume * 100);
    volumeSlider.value = percent;
    volumeValue.textContent = `${percent}%`;
    if (send && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ kind: 'set-volume', volume }));
    }
  }

  volumeSlider.addEventListener('input', (e) => {
    applyVolume(Number(e.target.value) / 100, true);
  });

  function applyTwitchStatus(status) {
    if (!status) return;
    if (status.connected) {
      twitchStatusEl.textContent = `Verbunden als ${status.channel}`;
      twitchStatusEl.classList.add('is-connected');
      twitchConnectLink.hidden = true;
      twitchDisconnectForm.hidden = false;
      if (status.sessionId) {
        window.RevealCopy.setValue(twitchSessionRevealEl, status.sessionId);
        twitchSessionEl.hidden = false;
      } else {
        twitchSessionEl.hidden = true;
      }
    } else {
      twitchStatusEl.textContent = 'Nicht verbunden';
      twitchStatusEl.classList.remove('is-connected');
      twitchConnectLink.hidden = false;
      twitchSessionEl.hidden = true;
      twitchDisconnectForm.hidden = true;
    }
  }

  function setStatus(connected) {
    statusEl.textContent = connected ? 'Verbunden' : 'Getrennt – versuche erneut…';
    statusEl.classList.toggle('is-connected', connected);
  }

  function send(alert) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ kind: 'trigger-alert', alert }));
    logEvent(alert);
  }

  function logEvent(alert) {
    const item = document.createElement('div');
    item.className = 'log-item';

    const type = document.createElement('span');
    type.textContent = alert.type;

    item.append(`${new Date().toLocaleTimeString()} — `, type, ` — ${alert.data.username}`);
    logEl.prepend(item);
  }

  document.getElementById('follow-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('follow-username').value.trim() || randomName();
    send({ type: 'follow', data: { username } });
  });

  const isGiftCheckbox = document.getElementById('sub-isgift');
  const resubFields = document.getElementById('resub-fields');
  const giftFields = document.getElementById('gift-fields');
  const subUsernameLabel = document.getElementById('sub-username-label');

  isGiftCheckbox.addEventListener('change', (e) => {
    giftFields.hidden = !e.target.checked;
    resubFields.hidden = e.target.checked;
    subUsernameLabel.textContent = e.target.checked ? 'Gifter Username' : 'Username';
  });

  // Hearing what an alert sounds like used to mean sending a full test
  // alert through the whole pipeline (WS -> overlay -> Alert Box entry)
  // just to hear one chime. This plays it directly, nothing else happens.
  document.querySelectorAll('.sound-preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const data = type === 'subscription' ? { isGift: isGiftCheckbox.checked } : {};
      window.AlertSounds.play(type, data);
    });
  });

  document.getElementById('sub-form').addEventListener('submit', (e) => {
    e.preventDefault();

    // For gift subs, Twitch only ever tells us the gifter's name — there
    // is no per-recipient data — so this field doubles as "gifter" when
    // Gift Sub is checked.
    const username = document.getElementById('sub-username').value.trim() || randomName();
    const tier = document.getElementById('sub-tier').value;
    const isGift = isGiftCheckbox.checked;

    const data = { username, tier, isGift };

    if (isGift) {
      data.giftCount = parseInt(document.getElementById('sub-giftcount').value, 10) || 1;
    } else {
      data.months = parseInt(document.getElementById('sub-months').value, 10) || 1;
      const message = document.getElementById('sub-message').value.trim();
      if (message) data.message = message;
    }

    send({ type: 'subscription', data });
  });

  document.getElementById('cheer-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('cheer-username').value.trim() || randomName();
    const bits = parseInt(document.getElementById('cheer-bits').value, 10) || 1;
    const message = document.getElementById('cheer-message').value.trim();
    send({ type: 'cheer', data: { username, bits, message } });
  });

  document.getElementById('raid-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('raid-username').value.trim() || randomName();
    const viewers = parseInt(document.getElementById('raid-viewers').value, 10) || 1;
    send({ type: 'raid', data: { username, viewers } });
  });

  connect();
})();
