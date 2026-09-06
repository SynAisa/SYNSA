(function () {
  const randomNames = [
    'nova_stream', 'pixelfox', 'glitchwave', 'moonrider', 'kaiden_tv',
    'echoplex', 'brightsignal', 'saltybard', 'quietstorm', 'ironwillow',
  ];
  const randomName = () => randomNames[Math.floor(Math.random() * randomNames.length)];

  const volumeSlider = document.getElementById('volume-slider');
  const volumeValue = document.getElementById('volume-value');
  const maintenanceMessage = 'Der Testbereich wird gerade überarbeitet.';

  // The server rejects the same messages as a second line of defence. Keeping
  // the UI controls disabled means the maintenance state is obvious before a
  // user tries an action, while real Twitch events keep their normal path.
  document.querySelectorAll('.volume-card input, .panel-grid input, .panel-grid select, .panel-grid button').forEach((control) => {
    control.disabled = true;
  });

  // Assigned at the very bottom, once every handler it dispatches into
  // exists. Nothing sends before then.
  let socket;

  // The Twitch connection moved to the settings: it is configured once, not
  // operated while streaming. This page keeps what you actually reach for
  // during a stream — test alerts and the master volume.
  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state) applyVolume(msg.state.volume, false);
    if (msg.kind === 'volume') applyVolume(msg.volume, false);
    if (msg.kind === 'control-panel-disabled') window.SynsaUI.showToast(t(msg.message || maintenanceMessage));
  }

  function applyVolume(volume, send) {
    const percent = Math.round(volume * 100);
    volumeSlider.value = percent;
    volumeValue.textContent = `${percent}%`;
    if (send) socket.send({ kind: 'set-volume', volume });
  }

  volumeSlider.addEventListener('input', (e) => {
    applyVolume(Number(e.target.value) / 100, true);
  });

  // Where a sent test alert shows up is the Alert Box on the dashboard, which
  // lists it with its real status (wartet / läuft / abgespielt) alongside
  // every genuine event. The local text log that used to sit at the bottom of
  // this page only repeated what it had just sent, without any of that.
  function send(alert) {
    socket.send({ kind: 'trigger-alert', alert });
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

  socket = connectPageSocket(handleMessage);
})();
