(function () {
  const form = document.getElementById('setup-form');
  const clientIdInput = document.getElementById('client-id');
  const clientSecretInput = document.getElementById('client-secret');
  const statusEl = document.getElementById('setup-status');
  const redirectUriEl = document.getElementById('redirect-uri');

  // The redirect URI has to match the Twitch app exactly, so show the one
  // this server actually uses rather than a hardcoded guess.
  fetch('/api/setup/status')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.redirectUri) redirectUriEl.textContent = data.redirectUri;
    })
    .catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = 'Speichern…';
    statusEl.classList.remove('is-success', 'is-error');

    try {
      const res = await fetch('/api/setup/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientIdInput.value,
          clientSecret: clientSecretInput.value,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Speichern fehlgeschlagen');
      }

      statusEl.textContent = 'Gespeichert';
      statusEl.classList.add('is-success');
      window.location.href = '/control.html';
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.classList.add('is-error');
    }
  });
})();
