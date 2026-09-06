// The stream itself: the LIVE indicator with uptime, and the title/category
// form above the two panels.
//
// Split out of dashboard.js for the same reason as the chatters list — it
// owns its elements and its state and shares nothing with the chat or the
// history. Two things are needed from outside: applyStatus(), for the live
// state the server broadcasts, and load(), to pull title and category once
// Twitch is connected.
(function () {
  const { isPanelOpen, openPanel, closePanel } = window.SynsaUI;

  const liveIndicatorEl = document.getElementById('live-indicator');
  const liveTextEl = document.getElementById('live-text');

  const streamInfoForm = document.getElementById('stream-info-form');
  const titleInput = document.getElementById('stream-title');
  const categoryInput = document.getElementById('stream-category');
  const categoryResultsEl = document.getElementById('category-results');
  const streamInfoStatusEl = document.getElementById('stream-info-status');

  const SEARCH_DEBOUNCE_MS = 300;
  const SAVE_STATUS_MS = 5000;

  // --- Live indicator + uptime -----------------------------------------------

  let liveTickTimer = null;

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  function applyStatus(status) {
    if (!status) return;

    clearInterval(liveTickTimer);
    liveTickTimer = null;

    const isLive = Boolean(status.live) && status.startedAt;
    liveIndicatorEl.classList.toggle('is-live', isLive);

    if (!isLive) {
      liveTextEl.textContent = t('Offline');
      return;
    }

    const tick = () => {
      liveTextEl.textContent = `LIVE · ${formatDuration(Date.now() - status.startedAt)}`;
    };
    tick();
    liveTickTimer = setInterval(tick, 1000);
  }

  // --- Title / category --------------------------------------------------------

  let currentGameId = null;

  async function load() {
    try {
      const res = await fetch('/api/twitch/channel');
      if (!res.ok) return;
      const info = await res.json();
      titleInput.value = info.title || '';
      categoryInput.value = info.gameName || '';
      currentGameId = info.gameId || null;
    } catch {
      // Twitch not connected yet, or a transient error — leave fields empty.
    }
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function renderCategoryResults(results) {
    categoryResultsEl.innerHTML = '';

    if (!results.length) {
      closePanel(categoryResultsEl);
      return;
    }

    results.forEach((game) => {
      const row = document.createElement('div');
      row.className = 'category-result';

      const img = document.createElement('img');
      img.src = game.boxArtUrl;
      img.alt = '';
      row.appendChild(img);

      const name = document.createElement('span');
      name.textContent = game.name;
      row.appendChild(name);

      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        categoryInput.value = game.name;
        currentGameId = game.id;
        closePanel(categoryResultsEl);
      });

      categoryResultsEl.appendChild(row);
    });

    openPanel(categoryResultsEl);
  }

  const searchCategories = debounce(async (query) => {
    if (!query) {
      closePanel(categoryResultsEl);
      return;
    }
    try {
      const res = await fetch(`/api/twitch/categories?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      renderCategoryResults(await res.json());
    } catch {
      // ignore — user can just retype
    }
  }, SEARCH_DEBOUNCE_MS);

  categoryInput.addEventListener('input', (e) => {
    searchCategories(e.target.value.trim());
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(categoryResultsEl) && !e.target.closest('.category-field')) {
      closePanel(categoryResultsEl);
    }
  });

  // Escape closes the suggestions, like every other popover on this page.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel(categoryResultsEl);
  });

  let statusHideTimer = null;

  streamInfoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearTimeout(statusHideTimer);
    streamInfoStatusEl.textContent = t('Speichern…');
    streamInfoStatusEl.classList.remove('is-success', 'is-error');
    openPanel(streamInfoStatusEl);

    try {
      const res = await fetch('/api/twitch/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleInput.value, gameId: currentGameId }),
      });
      if (!res.ok) throw new Error(t((await res.json().catch(() => ({}))).error || 'Fehler'));
      streamInfoStatusEl.textContent = t('Gespeichert');
      streamInfoStatusEl.classList.add('is-success');
    } catch (err) {
      streamInfoStatusEl.textContent = err.message;
      streamInfoStatusEl.classList.add('is-error');
    }

    statusHideTimer = setTimeout(() => closePanel(streamInfoStatusEl), SAVE_STATUS_MS);
  });

  load();

  window.DashboardStream = { applyStatus, load };
})();
