// Settings: the things that are configured once and then apply to all of
// SYNSA — the Twitch connection, and the interface language.
//
// Twitch used to sit on the control panel. It moved here because linking an
// account is a setting, not something you operate while streaming; the
// control panel keeps the test alerts and the volume.
(function () {
  const twitchStatusEl = document.getElementById('twitch-status');
  const twitchConnectLink = document.getElementById('twitch-connect');
  const twitchDisconnectForm = document.getElementById('twitch-disconnect-form');
  const twitchSessionEl = document.getElementById('twitch-session');
  const twitchSessionRevealEl = document.getElementById('twitch-session-reveal');

  const languageSelect = document.getElementById('language-select');

  function applyTwitchStatus(status) {
    if (!status) return;
    if (status.connected) {
      twitchStatusEl.textContent = `${t('Verbunden als')} ${status.channel}`;
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
      twitchStatusEl.textContent = t('Nicht verbunden');
      twitchStatusEl.classList.remove('is-connected');
      twitchConnectLink.hidden = false;
      twitchSessionEl.hidden = true;
      twitchDisconnectForm.hidden = true;
    }
  }

  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state) applyTwitchStatus(msg.state.twitch);
    if (msg.kind === 'twitch-status') applyTwitchStatus(msg.status);
  }

  // The status arrives over the socket as well, but only when it changes —
  // this fills the card on a fresh page load.
  fetch('/api/twitch/status')
    .then((res) => (res.ok ? res.json() : null))
    .then((status) => applyTwitchStatus(status))
    .catch(() => {
      // The socket below catches up as soon as something changes.
    });

  // --- Language ----------------------------------------------------------

  languageSelect.value = window.SynsaI18n.getLanguage();

  languageSelect.addEventListener('change', async () => {
    const language = languageSelect.value;
    languageSelect.disabled = true;
    try {
      await window.SynsaI18n.setLanguage(language);
      // Reloading rather than re-translating in place: every page builds some
      // of its text in JavaScript (status lines, changelog, chat rows), and a
      // reload is both simpler and guaranteed complete.
      location.reload();
    } catch {
      languageSelect.disabled = false;
    }
  });

  // --- Window close behavior ---------------------------------------------

  // The same setting the close dialog offers to remember (see the close
  // handler in electron/main.js). Both sides go through the one JSON file the
  // server reads and writes, so whichever place it was last changed in wins.
  const closeBehaviorSelect = document.getElementById('close-behavior-select');

  fetch('/api/close-behavior')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.closeBehavior) closeBehaviorSelect.value = data.closeBehavior;
    })
    .catch(() => {
      // Leaves the select on "Jedes Mal fragen", which is also the fallback
      // the app itself uses when nothing is stored.
    });

  closeBehaviorSelect.addEventListener('change', async () => {
    closeBehaviorSelect.disabled = true;
    try {
      const res = await fetch('/api/close-behavior', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closeBehavior: closeBehaviorSelect.value }),
      });
      if (!res.ok) window.SynsaUI.showToast(t('Speichern fehlgeschlagen.'));
    } catch {
      window.SynsaUI.showToast(t('Speichern fehlgeschlagen.'));
    }
    closeBehaviorSelect.disabled = false;
  });

  connectPageSocket(handleMessage);
})();
