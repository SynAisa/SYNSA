(function () {
  const chatMessagesEl = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const historyListEl = document.getElementById('history-list');

  const subscriptionWarningEl = document.getElementById('subscription-warning');

  const emotePickerBtn = document.getElementById('emote-picker-btn');
  const emotePicker = document.getElementById('emote-picker');
  const emotePickerSearch = document.getElementById('emote-picker-search');
  const emotePickerList = document.getElementById('emote-picker-list');

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

  // Assigned at the bottom, once every handler it dispatches into exists.
  let socket;
  let emoteMap = {};

  function handleMessage(msg) {
    if (msg.kind === 'state' && msg.state) {
      emoteMap = msg.state.emotes || {};
      DashboardStream.applyStatus(msg.state.stream);
    }
    if (msg.kind === 'stream-status' && msg.status) {
      DashboardStream.applyStatus(msg.status);
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
      showToast(t(msg.message));
    }
    if (msg.kind === 'state' && msg.state && msg.state.twitch) {
      applySubscriptionWarning(msg.state.twitch.subscriptions);
    }
    // Twitch may connect after this page is already open (first run, or a
    // reconnect) — pull the data that needs a live connection once it does.
    if (msg.kind === 'twitch-status' && msg.status) {
      applySubscriptionWarning(msg.status.subscriptions);
      if (msg.status.connected) {
        DashboardStream.load();
        DashboardChatters.refreshCount();
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
    heading.textContent = t('{n} von {total} Twitch-Abonnements konnten nicht eingerichtet werden.')
      .replace('{n}', subscriptions.failed.length)
      .replace('{total}', subscriptions.total);
    subscriptionWarningEl.appendChild(heading);
    subscriptionWarningEl.append(` ${t('Diese Ereignisse kommen nicht an:')}`);

    const list = document.createElement('div');
    subscriptions.failed.forEach((f) => {
      const row = document.createElement('div');
      row.textContent = `· ${f.type} — ${f.message}`;
      list.appendChild(row);
    });
    subscriptionWarningEl.appendChild(list);
    subscriptionWarningEl.hidden = false;
  }

  // Panel fades and toasts live in shared/ui.js — the gear menu and the
  // update banner use the exact same behaviour.
  const { isPanelOpen, openPanel, closePanel, showToast } = window.SynsaUI;

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
    socket.send({ kind: 'moderate', userId, duration: seconds });
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
    // The input is only cleared once the message is actually on its way, so
    // nothing is lost while the socket is reconnecting.
    if (!text || !socket.send({ kind: 'send-chat-message', text })) return;
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

  // Every keystroke used to rebuild the entire list: clearing it and creating
  // a button, an image and a listener for every matching emote — of which a
  // large 7TV set has thousands. Typing a three-letter name did that three
  // times over, and the field visibly stalled while it happened. Waiting for
  // a short pause renders once instead, with the same result: the filter is
  // read from the field when the timer fires, so what gets rendered is always
  // the current input.
  const EMOTE_SEARCH_DEBOUNCE_MS = 120;
  let emoteSearchTimer = null;

  emotePickerSearch.addEventListener('input', () => {
    clearTimeout(emoteSearchTimer);
    emoteSearchTimer = setTimeout(() => {
      renderEmotePicker(pickerData, emotePickerSearch.value.trim().toLowerCase());
    }, EMOTE_SEARCH_DEBOUNCE_MS);
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(emotePicker) && !e.target.closest('.chat-form')) {
      closePanel(emotePicker);
    }
  });

  function renderEmotePicker(data, filter) {
    emotePickerList.innerHTML = '';

    if (!data) {
      emotePickerList.innerHTML = `<div class="emote-picker-empty">${t('Konnte Emotes nicht laden.')}</div>`;
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
      emotePickerList.innerHTML = `<div class="emote-picker-empty">${t('Keine Treffer.')}</div>`;
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
      // Most rows read exactly the same as 15 seconds ago — "vor 3h" stays
      // that for an hour — and assigning an identical string still dirties
      // the node. Comparing first leaves those untouched.
      const next = formatRelativeTime(Number(el.dataset.timestamp));
      if (el.textContent !== next) el.textContent = next;
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


  socket = connectPageSocket(handleMessage);
})();
