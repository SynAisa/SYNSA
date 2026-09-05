(function () {
  const statusEl = document.getElementById('status');
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const historyListEl = document.getElementById('history-list');

  const liveIndicatorEl = document.getElementById('live-indicator');
  const liveTextEl = document.getElementById('live-text');
  const subscriptionWarningEl = document.getElementById('subscription-warning');

  const streamInfoForm = document.getElementById('stream-info-form');
  const titleInput = document.getElementById('stream-title');
  const categoryInput = document.getElementById('stream-category');
  const categoryResultsEl = document.getElementById('category-results');
  const streamInfoStatusEl = document.getElementById('stream-info-status');

  const emotePickerBtn = document.getElementById('emote-picker-btn');
  const emotePicker = document.getElementById('emote-picker');
  const emotePickerSearch = document.getElementById('emote-picker-search');
  const emotePickerList = document.getElementById('emote-picker-list');

  const chattersBtn = document.getElementById('chatters-btn');
  const chattersCountEl = document.getElementById('chatters-count');
  const chattersPanel = document.getElementById('chatters-panel');
  const chattersSearch = document.getElementById('chatters-search');
  const chattersList = document.getElementById('chatters-list');

  const MAX_ROWS = 200;

  const BADGE_LABELS = {
    broadcaster: 'HOST',
    moderator: 'MOD',
    vip: 'VIP',
    subscriber: 'SUB',
    founder: 'SUB',
  };

  const TIMEOUT_OPTIONS = [
    { label: '1s', seconds: 1 },
    { label: '10s', seconds: 10 },
    { label: '30s', seconds: 30 },
    { label: '1m', seconds: 60 },
    { label: '10m', seconds: 600 },
  ];

  let ws;
  let emoteMap = {};

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
        handleMessage(JSON.parse(event.data));
      } catch {
        // ignore malformed messages
      }
    });
  }

  function setStatus(connected) {
    statusEl.textContent = connected ? 'Verbunden' : 'Getrennt – versuche erneut…';
    statusEl.classList.toggle('is-connected', connected);
  }

  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state) {
      emoteMap = msg.state.emotes || {};
      applyStreamStatus(msg.state.stream);
    }
    if (msg.kind === 'stream-status' && msg.status) {
      applyStreamStatus(msg.status);
    }
    if (msg.kind === 'emotes' && msg.map) {
      emoteMap = msg.map;
    }
    if (msg.kind === 'chat-history' && msg.messages) {
      chatMessagesEl.innerHTML = '';
      // Render the whole batch without per-row scroll checks, then jump
      // straight to the bottom once — otherwise a long history visibly
      // crawls down row by row on first load.
      msg.messages.forEach((message) => renderChatMessage(message, { autoScroll: false, live: false }));
      scrollToBottom(chatMessagesEl);
    }
    if (msg.kind === 'chat-message' && msg.message) {
      renderChatMessage(msg.message);
    }
    if (msg.kind === 'event-history' && msg.events) {
      // A reconnect resends the whole history, so the rows these timers
      // point at are about to be thrown away.
      entryTimers.forEach((timer) => clearTimeout(timer));
      entryTimers.clear();
      historyListEl.innerHTML = '';
      // Anything from the bulk load already happened in a previous
      // session — only entries arriving live can plausibly still be
      // playing/waiting on the overlay right now.
      msg.events.forEach((entry) => renderHistoryEntry(entry, { live: false, autoScroll: false }));
      scrollToBottom(historyListEl);
    }
    if (msg.kind === 'event-history-append' && msg.entry) {
      renderHistoryEntry(msg.entry, { live: true });
    }
    if (msg.kind === 'event-status' && msg.id && msg.status) {
      applyEntryStatus(msg.id, msg.status);
    }
    if (msg.kind === 'moderation-error' && msg.message) {
      showToast(msg.message);
    }
    if (msg.kind === 'state' && msg.state && msg.state.twitch) {
      applySubscriptionWarning(msg.state.twitch.subscriptions);
    }
    // Twitch may connect after this page is already open (first run, or a
    // reconnect) — pull the data that needs a live connection once it does.
    if (msg.kind === 'twitch-status' && msg.status) {
      applySubscriptionWarning(msg.status.subscriptions);
      if (msg.status.connected) {
        loadStreamInfo();
        refreshChattersCount();
      }
    }
  }

  // Twitch accepting the connection but rejecting individual subscriptions
  // is the failure mode that hides best: everything looks connected while a
  // whole alert type never arrives. Name the ones that failed.
  function applySubscriptionWarning(subscriptions) {
    if (!subscriptions || !subscriptions.failed || !subscriptions.failed.length) {
      subscriptionWarningEl.hidden = true;
      return;
    }

    subscriptionWarningEl.replaceChildren();

    const heading = document.createElement('strong');
    const failedCount = subscriptions.failed.length;
    heading.textContent = `${failedCount} von ${subscriptions.total} Twitch-Abonnements konnten nicht eingerichtet werden.`;
    subscriptionWarningEl.appendChild(heading);
    subscriptionWarningEl.append(' Diese Ereignisse kommen nicht an:');

    const list = document.createElement('div');
    subscriptions.failed.forEach((f) => {
      const row = document.createElement('div');
      row.textContent = `· ${f.type} — ${f.message}`;
      list.appendChild(row);
    });
    subscriptionWarningEl.appendChild(list);
    subscriptionWarningEl.hidden = false;
  }

  // Shared open/close for every dropdown-style popover (chatters, emote
  // picker, category search results, the gear menu). They used to just flip
  // the `hidden` attribute, which pops an element in and out of existence
  // instantly — the same abruptness the chat highlight had, just on five
  // more elements. `hidden` still gates actual DOM removal (so it stays out
  // of tab order and screen readers while closed), but only after the fade
  // has had time to play; `.is-visible` is the thing CSS actually animates
  // and the thing callers should check for current state.
  const PANEL_TRANSITION_MS = 140;
  const panelCloseTimers = new WeakMap();

  function isPanelOpen(el) {
    return el.classList.contains('is-visible');
  }

  function openPanel(el) {
    clearTimeout(panelCloseTimers.get(el));
    el.hidden = false;
    // Adding the class in the same tick as clearing `hidden` gives the
    // browser nothing to transition from — it would just render already
    // "open". One rAF lets the closed state paint first.
    requestAnimationFrame(() => el.classList.add('is-visible'));
  }

  function closePanel(el) {
    if (!isPanelOpen(el)) {
      el.hidden = true;
      return;
    }
    el.classList.remove('is-visible');
    const timer = setTimeout(() => {
      el.hidden = true;
    }, PANEL_TRANSITION_MS);
    panelCloseTimers.set(el, timer);
  }

  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), PANEL_TRANSITION_MS);
    }, 4000);
  }

  // --- Chat ---------------------------------------------------------------

  const CHAT_HIGHLIGHT_MS = 5000;

  function renderChatMessage(message, { autoScroll = true, live = true } = {}) {
    const row = document.createElement('div');
    // A `@keyframes animation` (unlike a `transition`) starts from its own
    // 0% keyframe regardless of when the class lands, so — unlike the
    // popovers' `.is-visible` — this doesn't need a rAF tick before adding
    // it; applying it immediately is exactly what worked originally.
    row.className = live ? 'chat-message chat-message--new' : 'chat-message';
    if (live) {
      setTimeout(() => row.classList.remove('chat-message--new'), CHAT_HIGHLIGHT_MS);
    }

    // "vor Xm" (used in the Alert Box) would keep rewriting itself and drift
    // as messages scroll past — a fixed clock time doesn't need updating and
    // is what you actually want when scrolling back through a chat log.
    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = formatClockTime(message.timestamp);
    row.appendChild(timeEl);

    (message.badges || []).forEach((setId) => {
      const label = BADGE_LABELS[setId];
      if (!label) return;
      const pill = document.createElement('span');
      pill.className = `badge badge-${setId}`;
      pill.textContent = label;
      row.appendChild(pill);
    });

    const usernameEl = document.createElement('span');
    usernameEl.className = 'chat-username';
    usernameEl.textContent = message.username;
    usernameEl.style.color = message.color || 'var(--accent)';
    row.appendChild(usernameEl);

    const sep = document.createElement('span');
    sep.className = 'chat-colon';
    sep.textContent = ':';
    row.appendChild(sep);

    const textEl = document.createElement('span');
    textEl.className = 'chat-text';
    renderFragments(textEl, message.fragments || []);
    row.appendChild(textEl);

    if (message.userId) {
      row.appendChild(buildModControls(message.userId));
    }

    appendRow(chatMessagesEl, row, { autoScroll });
  }

  // Only follow along if the view is already at the bottom — otherwise the
  // next message would yank you away from whatever you scrolled up to read.
  // Bulk loads (autoScroll: false) skip this per-row check entirely — the
  // caller snaps to the bottom once after the whole batch is in, so a long
  // history doesn't visibly crawl down row by row on first load.
  function appendRow(container, row, { autoScroll = true } = {}) {
    const wasAtBottom =
      autoScroll && container.scrollHeight - container.scrollTop - container.clientHeight < 40;

    container.appendChild(row);
    trim(container);

    if (wasAtBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  function buildModControls(userId) {
    const wrapper = document.createElement('span');
    wrapper.className = 'mod-controls';

    const modBtn = document.createElement('button');
    modBtn.type = 'button';
    modBtn.className = 'mod-btn';
    modBtn.title = 'Moderation';
    modBtn.textContent = '⋯';
    wrapper.appendChild(modBtn);

    const menu = document.createElement('div');
    menu.className = 'mod-menu';
    menu.hidden = true;
    wrapper.appendChild(menu);

    // Built on first open rather than up front: every chat row carries one
    // of these, so eagerly creating six buttons plus their listeners meant
    // ~900 nodes for a full 150-message backlog that almost nobody ever
    // clicks.
    let built = false;

    function buildMenu() {
      TIMEOUT_OPTIONS.forEach(({ label, seconds }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendModeration(userId, seconds);
          menu.hidden = true;
        });
        menu.appendChild(btn);
      });

      const banBtn = document.createElement('button');
      banBtn.type = 'button';
      banBtn.className = 'mod-ban-btn';
      banBtn.textContent = 'Ban';
      banBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendModeration(userId, undefined);
        menu.hidden = true;
      });
      menu.appendChild(banBtn);

      built = true;
    }

    modBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = menu.hidden;
      document.querySelectorAll('.mod-menu').forEach((m) => {
        m.hidden = true;
      });
      if (wasHidden && !built) buildMenu();
      menu.hidden = !wasHidden;
    });

    return wrapper;
  }

  function sendModeration(userId, seconds) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ kind: 'moderate', userId, duration: seconds }));
  }

  document.addEventListener('click', () => {
    document.querySelectorAll('.mod-menu').forEach((m) => {
      m.hidden = true;
    });
  });

  // Each popover already closes on an outside click; Escape only ever
  // closed the gear menu (public/shared/module-menu.js), so the others
  // needed a click elsewhere on the page even when your hands were already
  // on the keyboard. One listener for all of them, consistent with that
  // menu's behaviour.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.mod-menu').forEach((m) => {
      m.hidden = true;
    });
    closePanel(emotePicker);
    closePanel(chattersPanel);
    closePanel(categoryResultsEl);
  });

  // Twitch's own emotes come pre-identified via message fragments; 7TV
  // emotes aren't, so plain text fragments get tokenized and matched
  // against the name -> URL map from the server.
  function renderFragments(container, fragments) {
    fragments.forEach((fragment) => {
      if (fragment.type === 'emote' && fragment.emoteId) {
        container.appendChild(
          makeEmoteImg(`https://static-cdn.jtvnw.net/emoticons/v2/${fragment.emoteId}/default/dark/3.0`, fragment.text)
        );
        return;
      }
      renderTextWithSevenTv(container, fragment.text || '');
    });
  }

  function renderTextWithSevenTv(container, text) {
    text.split(/(\s+)/).forEach((token) => {
      if (!token) return;
      const url = emoteMap[token];
      if (url) {
        container.appendChild(makeEmoteImg(url, token));
      } else {
        container.appendChild(document.createTextNode(token));
      }
    });
  }

  function makeEmoteImg(src, alt) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.title = alt;
    img.className = 'chat-emote';
    img.loading = 'lazy';
    return img;
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ kind: 'send-chat-message', text }));
    chatInput.value = '';
  });

  // --- Emote picker ---------------------------------------------------------

  let pickerData = null;

  async function ensurePickerData() {
    if (pickerData) return pickerData;
    try {
      const res = await fetch('/api/twitch/emotes');
      pickerData = res.ok ? await res.json() : null;
    } catch {
      pickerData = null;
    }
    return pickerData;
  }

  emotePickerBtn.addEventListener('click', async () => {
    if (isPanelOpen(emotePicker)) {
      closePanel(emotePicker);
      return;
    }
    openPanel(emotePicker);

    emotePickerSearch.value = '';
    emotePickerList.innerHTML = '<div class="emote-picker-empty">Lade…</div>';
    const data = await ensurePickerData();
    renderEmotePicker(data, '');
    emotePickerSearch.focus();
  });

  emotePickerSearch.addEventListener('input', (e) => {
    renderEmotePicker(pickerData, e.target.value.trim().toLowerCase());
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(emotePicker) && !e.target.closest('.chat-form')) {
      closePanel(emotePicker);
    }
  });

  function renderEmotePicker(data, filter) {
    emotePickerList.innerHTML = '';

    if (!data) {
      emotePickerList.innerHTML = '<div class="emote-picker-empty">Konnte Emotes nicht laden.</div>';
      return;
    }

    const groups = [];
    if (data.sevenTv && data.sevenTv.channel && data.sevenTv.channel.length) {
      groups.push({ title: '7TV · Kanal', emotes: data.sevenTv.channel });
    }
    if (data.sevenTv && data.sevenTv.global && data.sevenTv.global.length) {
      groups.push({ title: '7TV · Global', emotes: data.sevenTv.global });
    }
    (data.twitch || []).forEach((group) => {
      groups.push({ title: `Twitch · ${group.ownerName}`, emotes: group.emotes });
    });

    let any = false;

    groups.forEach((group) => {
      const filtered = filter
        ? group.emotes.filter((emote) => emote.name.toLowerCase().includes(filter))
        : group.emotes;
      if (!filtered.length) return;
      any = true;

      const title = document.createElement('div');
      title.className = 'emote-group-title';
      title.textContent = group.title;
      emotePickerList.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'emote-grid';

      filtered.forEach((emote) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = emote.name;

        const img = document.createElement('img');
        img.src = emote.url;
        img.alt = emote.name;
        img.loading = 'lazy';
        btn.appendChild(img);

        btn.addEventListener('click', () => insertEmote(emote.name));
        grid.appendChild(btn);
      });

      emotePickerList.appendChild(grid);
    });

    if (!any) {
      emotePickerList.innerHTML = '<div class="emote-picker-empty">Keine Treffer.</div>';
    }
  }

  function insertEmote(name) {
    const start = chatInput.selectionStart ?? chatInput.value.length;
    const end = chatInput.selectionEnd ?? chatInput.value.length;
    const before = chatInput.value.slice(0, start);
    const after = chatInput.value.slice(end);
    const needsSpaceBefore = before.length > 0 && !before.endsWith(' ');
    const insertion = `${needsSpaceBefore ? ' ' : ''}${name} `;

    chatInput.value = before + insertion + after;
    const cursor = (before + insertion).length;
    chatInput.focus();
    chatInput.setSelectionRange(cursor, cursor);
  }

  // --- Chatters (who's currently in chat) ------------------------------------

  let chattersData = null;

  async function fetchChatters() {
    try {
      const res = await fetch('/api/twitch/chatters');
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async function refreshChattersCount() {
    const data = await fetchChatters();
    if (data) {
      chattersData = data;
      chattersCountEl.textContent = String(data.total);
    }
  }

  chattersBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isPanelOpen(chattersPanel)) {
      closePanel(chattersPanel);
      return;
    }
    openPanel(chattersPanel);

    chattersSearch.value = '';
    chattersList.innerHTML = '<div class="chatters-empty">Lade…</div>';
    const data = await fetchChatters();
    chattersData = data;
    if (data) chattersCountEl.textContent = String(data.total);
    renderChattersList(data, '');
    chattersSearch.focus();
  });

  chattersSearch.addEventListener('input', (e) => {
    renderChattersList(chattersData, e.target.value.trim().toLowerCase());
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(chattersPanel) && !e.target.closest('.chat-panel-title')) {
      closePanel(chattersPanel);
    }
  });

  const CHATTER_ROLE_LABELS = {
    broadcaster: 'Broadcaster',
    moderator: 'Moderatoren',
    vip: 'VIPs',
    subscriber: 'Abonnenten',
    viewer: 'Zuschauer',
  };
  const CHATTER_ROLE_ORDER = ['broadcaster', 'moderator', 'vip', 'subscriber', 'viewer'];

  function renderChattersList(data, filter) {
    chattersList.innerHTML = '';

    if (!data) {
      chattersList.innerHTML = '<div class="chatters-empty">Konnte Chatter nicht laden.</div>';
      return;
    }

    const filtered = filter
      ? data.chatters.filter((c) => c.name.toLowerCase().includes(filter))
      : data.chatters;

    if (!filtered.length) {
      chattersList.innerHTML = '<div class="chatters-empty">Keine Treffer.</div>';
      return;
    }

    CHATTER_ROLE_ORDER.forEach((role) => {
      const group = filtered.filter((c) => c.role === role);
      if (!group.length) return;

      const title = document.createElement('div');
      title.className = 'chatters-group-title';
      title.textContent = `${CHATTER_ROLE_LABELS[role]} · ${group.length}`;
      chattersList.appendChild(title);

      group.forEach((c) => {
        const row = document.createElement('div');
        row.className = `chatters-row chatters-role-${role}`;
        row.textContent = c.name;
        chattersList.appendChild(row);
      });
    });
  }

  // Each poll is a Twitch API round trip (~0.7s worth of work server-side),
  // and the app lives in the tray — it spends most of its life minimized or
  // behind OBS, where nobody can see the number anyway. Refresh on the way
  // back instead, so it's current the moment it becomes visible again.
  refreshChattersCount();
  setInterval(() => {
    if (!document.hidden) refreshChattersCount();
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshChattersCount();
  });

  // --- Hover tooltip for truncated messages ----------------------------------

  // One shared tooltip element rather than one per row — with a long
  // history that's a couple of DOM nodes instead of a couple hundred, and
  // the show/hide animation is a plain CSS transition, never a JS-driven
  // one, so hovering never costs a layout/paint loop.
  //
  // The listeners themselves are attached directly to each truncated row
  // (mouseenter/mouseleave) rather than delegated on the container via
  // mouseover/mouseout + relatedTarget — that combination is unreliable
  // for synthetic/automated pointer events, and only rows that actually
  // got truncated (a small subset of the list) carry a listener anyway,
  // so delegation wasn't buying anything here.
  let tooltipEl = null;
  let tooltipHideTimer = null;

  function ensureTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'history-tooltip';
      tooltipEl.hidden = true;
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function showTooltip(target) {
    const tooltip = ensureTooltip();
    clearTimeout(tooltipHideTimer);

    tooltip.textContent = target.dataset.full;
    tooltip.hidden = false;

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = targetRect.left;
    left = Math.min(left, window.innerWidth - tooltipRect.width - 8);
    left = Math.max(left, 8);

    let top = targetRect.top - tooltipRect.height - 8;
    if (top < 8) top = targetRect.bottom + 8; // not enough room above — flip below

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    requestAnimationFrame(() => tooltip.classList.add('is-visible'));
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove('is-visible');
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = setTimeout(() => {
      if (tooltipEl) tooltipEl.hidden = true;
    }, 150);
  }

  // A stale tooltip floating over rows it no longer points at looks broken.
  historyListEl.addEventListener('scroll', hideTooltip);

  // --- Event history --------------------------------------------------------

  // Rows stay in the DOM either way — filtering just toggles `hidden`,
  // so switching filters (or a live alert arriving under a hidden type)
  // is a plain attribute flip, not a re-render, no matter how long the
  // history gets.
  let historyFilter = 'all';

  document.querySelectorAll('.history-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      historyFilter = btn.dataset.filter;
      document.querySelectorAll('.history-filter').forEach((b) => b.classList.toggle('is-active', b === btn));
      historyListEl.querySelectorAll('.history-entry').forEach((row) => {
        row.hidden = historyFilter !== 'all' && row.dataset.type !== historyFilter;
      });
      // Switching filters changes what "the bottom" even means — jump to
      // the newest match rather than leaving the scroll wherever it was
      // under the old filter.
      scrollToBottom(historyListEl);
    });
  });

  // Only entries that arrive while this page is open can plausibly still
  // be sitting in the overlay's queue — if the overlay never confirms
  // (not open, or a raid dumps a long backlog), this is the fallback that
  // stops a row from looking stuck forever.
  const PENDING_FALLBACK_MS = 60000;
  // Longest an alert can stay on screen (overlay.js MAX_DISPLAY_MS) plus
  // room for the exit animation and a slow frame or two.
  const PLAYING_FALLBACK_MS = 20000;
  const entryTimers = new Map();

  const HISTORY_STATUS_LABELS = {
    pending: 'Wartet',
    playing: '● Wird abgespielt',
  };

  function renderHistoryEntry(entry, { live = false, autoScroll = true } = {}) {
    const config = (window.ALERT_TYPES && window.ALERT_TYPES[entry.alert.type]) || {};
    const data = entry.alert.data || {};

    const row = document.createElement('div');
    row.className = 'history-entry';
    row.dataset.id = entry.id;
    row.dataset.type = entry.alert.type;
    row.hidden = historyFilter !== 'all' && historyFilter !== entry.alert.type;

    const icon = document.createElement('div');
    icon.className = 'history-icon';
    icon.dataset.type = entry.alert.type;
    icon.innerHTML = config.icon || '';
    row.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'history-body';

    const status = document.createElement('div');
    status.className = 'history-status';
    status.hidden = true;
    body.appendChild(status);

    const title = document.createElement('div');
    title.className = 'history-title';
    const typeLabel = data.isGift && config.giftLabel ? config.giftLabel : (config.label || entry.alert.type);
    title.textContent = `${typeLabel} · ${data.username || 'Anonymous'}`;
    body.appendChild(title);

    const detailText = window.buildAlertDetail ? window.buildAlertDetail(entry.alert.type, data) : '';
    if (detailText) {
      const detail = document.createElement('div');
      detail.className = 'history-detail';
      detail.textContent = detailText;

      const fullDetailText = window.buildAlertDetail
        ? window.buildAlertDetail(entry.alert.type, data, { truncate: false })
        : detailText;
      if (fullDetailText !== detailText) {
        detail.classList.add('history-detail--truncated');
        detail.dataset.full = fullDetailText;
        detail.addEventListener('mouseenter', () => showTooltip(detail));
        detail.addEventListener('mouseleave', hideTooltip);
      }

      body.appendChild(detail);
    }

    row.appendChild(body);

    const time = document.createElement('div');
    time.className = 'history-time';
    time.dataset.timestamp = String(entry.timestamp);
    time.textContent = formatRelativeTime(entry.timestamp);
    row.appendChild(time);

    appendRow(historyListEl, row, { autoScroll });

    if (live) {
      setEntryStatus(row, 'pending');
      const timer = setTimeout(() => {
        entryTimers.delete(entry.id);
        setEntryStatus(row, 'done');
      }, PENDING_FALLBACK_MS);
      entryTimers.set(entry.id, timer);
    }
  }

  function applyEntryStatus(id, status) {
    const row = historyListEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!row) return;

    clearTimeout(entryTimers.get(id));
    entryTimers.delete(id);
    setEntryStatus(row, status);

    // "playing" used to clear the fallback without arming a new one, so a
    // lost "done" — overlay closed mid-alert, scene switch, a WS blip while
    // it was on screen — left the row pulsing forever. An alert can run at
    // most MAX_DISPLAY_MS, so anything past that is definitely over.
    if (status === 'playing') {
      const timer = setTimeout(() => {
        entryTimers.delete(id);
        setEntryStatus(row, 'done');
      }, PLAYING_FALLBACK_MS);
      entryTimers.set(id, timer);
    }

    // A long queue drains without adding any new rows — nothing else
    // would ever bring the "now playing" entry into view as it moves
    // through an already-rendered list, so this always follows it, even
    // if you'd scrolled away to read something. Skipped for a row a
    // filter is currently hiding — it has no real position to scroll to.
    if (status === 'playing' && !row.hidden) {
      scrollRowIntoView(row);
    }
  }

  function scrollRowIntoView(row) {
    const container = historyListEl;
    // getBoundingClientRect is screen-space, so it's immune to which
    // ancestor happens to be offsetParent — offsetTop looked like the
    // obvious tool here but silently measures from the nearest
    // position:relative ancestor, which is .history-panel (it needs that
    // for its accent-stripe pseudo-element), not this scroll container.
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();

    let delta = 0;
    if (rowRect.top < containerRect.top) {
      delta = rowRect.top - containerRect.top;
    } else if (rowRect.bottom > containerRect.bottom) {
      delta = rowRect.bottom - containerRect.bottom;
    }

    if (delta !== 0) {
      container.scrollBy({ top: delta, behavior: 'smooth' });
    }
  }

  function setEntryStatus(row, status) {
    row.classList.remove('history-entry--pending', 'history-entry--playing');
    const statusEl = row.querySelector('.history-status');

    if (status === 'pending' || status === 'playing') {
      row.classList.add(`history-entry--${status}`);
      statusEl.textContent = HISTORY_STATUS_LABELS[status];
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }

  function formatClockTime(timestamp) {
    const d = new Date(timestamp);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function formatRelativeTime(timestamp) {
    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSec < 5) return 'gerade eben';
    if (diffSec < 60) return `vor ${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `vor ${diffMin}m`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `vor ${diffHour}h`;
    const diffDay = Math.floor(diffHour / 24);
    return `vor ${diffDay}d`;
  }

  function refreshRelativeTimes() {
    historyListEl.querySelectorAll('.history-time[data-timestamp]').forEach((el) => {
      el.textContent = formatRelativeTime(Number(el.dataset.timestamp));
    });
  }

  setInterval(() => {
    // Rewriting 200 timestamps forces a style recalc every 15s — pointless
    // while the window is hidden. They're all refreshed on the way back.
    if (!document.hidden) refreshRelativeTimes();
  }, 15000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRelativeTimes();
  });

  function trim(el) {
    while (el.children.length > MAX_ROWS) {
      el.removeChild(el.firstChild);
    }
  }

  // --- Live indicator + uptime -----------------------------------------------

  let liveTickTimer = null;

  function applyStreamStatus(status) {
    if (!status) return;

    clearInterval(liveTickTimer);
    liveTickTimer = null;

    const isLive = Boolean(status.live) && status.startedAt;
    liveIndicatorEl.classList.toggle('is-live', isLive);

    if (!isLive) {
      liveTextEl.textContent = 'Offline';
      return;
    }

    const tick = () => {
      liveTextEl.textContent = `LIVE · ${formatDuration(Date.now() - status.startedAt)}`;
    };
    tick();
    liveTickTimer = setInterval(tick, 1000);
  }

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // --- Stream info (title / category) --------------------------------------

  let currentGameId = null;

  async function loadStreamInfo() {
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

  const searchCategories = debounce(async (query) => {
    if (!query) {
      closePanel(categoryResultsEl);
      return;
    }
    try {
      const res = await fetch(`/api/twitch/categories?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const results = await res.json();
      renderCategoryResults(results);
    } catch {
      // ignore — user can just retype
    }
  }, 300);

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

  categoryInput.addEventListener('input', (e) => {
    searchCategories(e.target.value.trim());
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(categoryResultsEl) && !e.target.closest('.category-field')) {
      closePanel(categoryResultsEl);
    }
  });

  let streamInfoStatusHideTimer = null;

  streamInfoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearTimeout(streamInfoStatusHideTimer);
    streamInfoStatusEl.textContent = 'Speichern…';
    streamInfoStatusEl.classList.remove('is-success', 'is-error');
    openPanel(streamInfoStatusEl);

    try {
      const res = await fetch('/api/twitch/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleInput.value, gameId: currentGameId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Fehler');
      streamInfoStatusEl.textContent = 'Gespeichert';
      streamInfoStatusEl.classList.add('is-success');
    } catch (err) {
      streamInfoStatusEl.textContent = err.message;
      streamInfoStatusEl.classList.add('is-error');
    }

    streamInfoStatusHideTimer = setTimeout(() => closePanel(streamInfoStatusEl), 5000);
  });

  loadStreamInfo();
  connect();
})();
