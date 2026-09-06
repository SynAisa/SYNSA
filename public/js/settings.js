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

  connectPageSocket(handleMessage);
})();
