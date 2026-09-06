// "Wer ist gerade im Chat" — the viewer count next to the chat title and the
// panel behind it.
//
// Split out of dashboard.js because it shares nothing with the rest of that
// page: it owns its own elements, its own data and its own polling, and the
// only thing anyone outside needs is refreshCount() — called once when Twitch
// connects. Everything else here stays here.
(function () {
  const { isPanelOpen, openPanel, closePanel } = window.SynsaUI;

  const chattersBtn = document.getElementById('chatters-btn');
  const chattersCountEl = document.getElementById('chatters-count');
  const chattersPanel = document.getElementById('chatters-panel');
  const chattersSearch = document.getElementById('chatters-search');
  const chattersList = document.getElementById('chatters-list');

  const ROLE_LABELS = {
    broadcaster: 'Broadcaster',
    moderator: 'Moderatoren',
    vip: 'VIPs',
    subscriber: 'Abonnenten',
    viewer: 'Zuschauer',
  };
  const ROLE_ORDER = ['broadcaster', 'moderator', 'vip', 'subscriber', 'viewer'];

  const REFRESH_MS = 60000;

  let chattersData = null;

  async function fetchChatters() {
    try {
      const res = await fetch('/api/twitch/chatters');
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async function refreshCount() {
    const data = await fetchChatters();
    if (data) {
      chattersData = data;
      chattersCountEl.textContent = String(data.total);
    }
  }

  function renderList(data, filter) {
    chattersList.innerHTML = '';

    if (!data) {
      chattersList.innerHTML = `<div class="chatters-empty">${t('Konnte Chatter nicht laden.')}</div>`;
      return;
    }

    const filtered = filter ? data.chatters.filter((c) => c.name.toLowerCase().includes(filter)) : data.chatters;

    if (!filtered.length) {
      chattersList.innerHTML = `<div class="chatters-empty">${t('Keine Treffer.')}</div>`;
      return;
    }

    ROLE_ORDER.forEach((role) => {
      const group = filtered.filter((c) => c.role === role);
      if (!group.length) return;

      const title = document.createElement('div');
      title.className = 'chatters-group-title';
      title.textContent = `${t(ROLE_LABELS[role])} · ${group.length}`;
      chattersList.appendChild(title);

      group.forEach((c) => {
        const row = document.createElement('div');
        row.className = `chatters-row chatters-role-${role}`;
        row.textContent = c.name;
        chattersList.appendChild(row);
      });
    });
  }

  chattersBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isPanelOpen(chattersPanel)) {
      closePanel(chattersPanel);
      return;
    }
    openPanel(chattersPanel);

    chattersSearch.value = '';
    chattersList.innerHTML = `<div class="chatters-empty">${t('Lade…')}</div>`;
    const data = await fetchChatters();
    chattersData = data;
    if (data) chattersCountEl.textContent = String(data.total);
    renderList(data, '');
    chattersSearch.focus();
  });

  chattersSearch.addEventListener('input', (e) => {
    renderList(chattersData, e.target.value.trim().toLowerCase());
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(chattersPanel) && !e.target.closest('.chat-panel-title')) {
      closePanel(chattersPanel);
    }
  });

  // Escape closes it, like every other popover on this page.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel(chattersPanel);
  });

  // Each poll is a Twitch API round trip (~0.7s worth of work server-side),
  // and the app lives in the tray — it spends most of its life minimized or
  // behind OBS, where nobody can see the number anyway. Refresh on the way
  // back instead, so it's current the moment it becomes visible again.
  refreshCount();
  setInterval(() => {
    if (!document.hidden) refreshCount();
  }, REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCount();
  });

  window.DashboardChatters = { refreshCount };
})();
