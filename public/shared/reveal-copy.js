// Masks a sensitive-ish value (a Browser Source URL, a session id) behind a
// dot-mask by default, with an eye button to reveal it and a separate copy
// button that works whether or not it's currently revealed — so pasting it
// into OBS never requires putting it on screen at all. Used on any page
// with a `[data-reveal-copy]` element (control.html, music-settings.html,
// countdown-settings.html).
(function () {
  const EYE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a15.6 15.6 0 0 1-3.4 4.3M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7a9.9 9.9 0 0 0 4-.8"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/></svg>';
  const COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/></svg>';
  const CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';

  function maskFor(value) {
    const len = Math.max(10, Math.min(28, value.length));
    return '•'.repeat(len);
  }

  function init(el) {
    const valueEl = el.querySelector('.reveal-copy-value');
    const eyeBtn = el.querySelector('.reveal-copy-eye');
    const copyBtn = el.querySelector('.reveal-copy-btn');
    let revealed = false;

    function render() {
      const value = el.dataset.value || '';
      valueEl.textContent = value ? (revealed ? value : maskFor(value)) : '';
      eyeBtn.innerHTML = revealed ? EYE_OFF_ICON : EYE_ICON;
      eyeBtn.title = revealed ? 'Verbergen' : 'Anzeigen';
    }

    eyeBtn.addEventListener('click', () => {
      revealed = !revealed;
      render();
    });

    copyBtn.addEventListener('click', async () => {
      const value = el.dataset.value || '';
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        copyBtn.innerHTML = CHECK_ICON;
        copyBtn.classList.add('is-copied');
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.classList.remove('is-copied');
        }, 1200);
      } catch {
        // Clipboard access denied — nothing sensible to fall back to here.
      }
    });

    copyBtn.innerHTML = COPY_ICON;
    render();

    // Lets a page update the value after the fact (e.g. control.js only
    // learns the Twitch session id once the connection comes up).
    el.__revealCopyRender = render;
  }

  document.querySelectorAll('[data-reveal-copy]').forEach(init);

  window.RevealCopy = {
    setValue(el, value) {
      if (!el) return;
      el.dataset.value = value || '';
      if (el.__revealCopyRender) el.__revealCopyRender();
    },
  };
})();
