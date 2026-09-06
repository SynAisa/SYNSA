// Guided tour of the dashboard: three stops that explain what the panels are
// for, not which button does what.
//
// It highlights the real panels rather than pictures of them — a full-screen
// dimming layer goes over the page and the panel being explained is lifted
// above it with a class. That means no copy of the panel to keep in sync, and
// no change to the layout: .panel is already position:relative, so raising it
// only needs a z-index, which moves nothing.
//
// Shown automatically the first time the dashboard is opened and never again
// once it has been dealt with; the settings page can start it again at any
// time by linking to /dashboard.html?tour=1.
//
// German is the source language here as everywhere else — every string below
// goes through t(), so the English table translates it.
(function () {
  // Versioned on purpose: if the dashboard changes enough that the tour is
  // worth showing again, a new key (…v2) reintroduces it for everyone without
  // touching anything else. Stored in localStorage, like the language — this
  // is per-install interface state the page decides on its own, and it needs
  // no server round trip to answer "has this been seen".
  const STORAGE_KEY = 'synsa.dashboardTour.v1';

  const STEPS = [
    // Opens the tour without highlighting anything: right after the setup this
    // is the first thing a new user sees, so it says what SYNSA is before it
    // starts pointing at panels. It carries no step counter — the tour still
    // has three stops, this is the greeting in front of them.
    {
      intro: true,
      selector: null,
      title: 'Willkommen zu SYNSA',
      paragraphs: [
        'Willkommen zu SYNSA, deinem Twitch-Terminal.',
        'Dieser kurze Rundgang zeigt dir in drei Schritten, wofür die Bereiche des Dashboards da sind.',
      ],
    },
    {
      selector: '.stream-info-panel',
      title: 'Stream-Info',
      paragraphs: [
        'Hier kannst du die Kategorie und den Titel deines Streams festlegen. Änderungen werden direkt auf Twitch übernommen. Dafür muss dein Twitch-Konto mit SYNSA verknüpft sein.',
      ],
    },
    {
      selector: '.history-panel',
      title: 'Alert Box',
      paragraphs: [
        'Hier laufen die Ereignisse deines Streams auf, das Neueste zuunterst.',
        'Es gibt vier Typen, jeder mit eigenem Symbol: New Follower, New Subscriber (bei verschenkten Abos Gift Sub), Cheer und Raid. Über die Knöpfe darüber blendest du einzelne Typen aus.',
        'Jede Zeile zeigt zusätzlich, ob ein Alert noch wartet, gerade abgespielt wird oder schon durch ist.',
      ],
    },
    {
      selector: '.chat-panel',
      title: 'Chat',
      paragraphs: [
        'Hier kannst du den Twitch-Chat direkt über SYNSA verfolgen und moderieren.',
        'Über die drei Punkte neben einer Nachricht öffnest du die Moderationsaktionen.',
        'Ein Timeout sperrt einen Nutzer vorübergehend vom Chat.',
        'Ein Ban sperrt einen Nutzer dauerhaft aus deinem Chat, bis du ihn wieder entbannst.',
      ],
    },
  ];

  // Distance between the highlighted panel and the card, and the smallest gap
  // the card keeps to the window edge.
  const CARD_GAP = 16;
  const VIEWPORT_MARGIN = 12;

  const HIGHLIGHT_CLASS = 'tour-highlight';

  let overlayEl = null;
  let cardEl = null;
  let titleEl = null;
  let textEl = null;
  let progressEl = null;
  let backBtn = null;
  let nextBtn = null;
  let currentIndex = -1;
  let highlighted = null;

  function hasSeen() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'done';
    } catch {
      // Storage blocked — treat it as seen rather than reopening the tour on
      // every single visit.
      return true;
    }
  }

  function markSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, 'done');
    } catch {
      // Not being able to remember it only means it may appear again.
    }
  }

  function build() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'tour-overlay';

    cardEl = document.createElement('div');
    cardEl.className = 'tour-card';
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'tour-card-head';

    progressEl = document.createElement('span');
    progressEl.className = 'tour-progress';
    head.appendChild(progressEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tour-close';
    closeBtn.textContent = '×';
    closeBtn.title = t('Rundgang schließen');
    closeBtn.setAttribute('aria-label', t('Rundgang schließen'));
    closeBtn.addEventListener('click', finish);
    head.appendChild(closeBtn);

    cardEl.appendChild(head);

    titleEl = document.createElement('h2');
    titleEl.className = 'tour-title';
    cardEl.appendChild(titleEl);

    textEl = document.createElement('div');
    textEl.className = 'tour-text';
    cardEl.appendChild(textEl);

    const actions = document.createElement('div');
    actions.className = 'tour-actions';

    backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'tour-btn tour-btn-secondary';
    backBtn.textContent = t('Zurück');
    backBtn.addEventListener('click', () => show(currentIndex - 1));
    actions.appendChild(backBtn);

    nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'tour-btn tour-btn-primary';
    nextBtn.addEventListener('click', () => {
      if (currentIndex >= STEPS.length - 1) finish();
      else show(currentIndex + 1);
    });
    actions.appendChild(nextBtn);

    cardEl.appendChild(actions);

    document.body.appendChild(overlayEl);
    document.body.appendChild(cardEl);
  }

  function clearHighlight() {
    if (highlighted) {
      highlighted.classList.remove(HIGHLIGHT_CLASS);
      highlighted = null;
    }
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  // Four candidate placements, first one that fits wins, then clamped into the
  // window. Deliberately not a general-purpose positioning engine: with three
  // fixed stops in a layout that always fills exactly one screen, this covers
  // every case the tour can actually reach.
  function positionCard(target) {
    const cardRect = cardEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // The greeting points at nothing, so it belongs in the middle.
    if (!target) {
      cardEl.style.left = `${Math.max(VIEWPORT_MARGIN, (vw - cardRect.width) / 2)}px`;
      cardEl.style.top = `${Math.max(VIEWPORT_MARGIN, (vh - cardRect.height) / 2)}px`;
      return;
    }

    const targetRect = target.getBoundingClientRect();

    let left;
    let top;

    if (targetRect.right + CARD_GAP + cardRect.width + VIEWPORT_MARGIN <= vw) {
      left = targetRect.right + CARD_GAP;
      top = targetRect.top;
    } else if (targetRect.left - CARD_GAP - cardRect.width >= VIEWPORT_MARGIN) {
      left = targetRect.left - CARD_GAP - cardRect.width;
      top = targetRect.top;
    } else if (targetRect.bottom + CARD_GAP + cardRect.height + VIEWPORT_MARGIN <= vh) {
      left = targetRect.left + (targetRect.width - cardRect.width) / 2;
      top = targetRect.bottom + CARD_GAP;
    } else {
      left = targetRect.left + (targetRect.width - cardRect.width) / 2;
      top = targetRect.top - CARD_GAP - cardRect.height;
    }

    cardEl.style.left = `${clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, vw - cardRect.width - VIEWPORT_MARGIN))}px`;
    cardEl.style.top = `${clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, vh - cardRect.height - VIEWPORT_MARGIN))}px`;
  }

  function show(index) {
    if (index < 0 || index >= STEPS.length) return;

    const step = STEPS[index];
    const target = step.selector ? document.querySelector(step.selector) : null;
    // A panel the dashboard doesn't have is not worth stopping the tour over —
    // skip ahead instead of leaving the user in a dimmed room with nothing lit.
    // The greeting has no selector at all and is not affected by this.
    if (step.selector && !target) {
      if (index > currentIndex) show(index + 1);
      else show(index - 1);
      return;
    }

    currentIndex = index;

    clearHighlight();
    if (target) {
      target.classList.add(HIGHLIGHT_CLASS);
      highlighted = target;
    }

    titleEl.textContent = t(step.title);

    textEl.replaceChildren();
    step.paragraphs.forEach((paragraph) => {
      const p = document.createElement('p');
      p.textContent = t(paragraph);
      textEl.appendChild(p);
    });

    // Counted over the three stops only, so the greeting in front of them
    // doesn't turn the tour into "1 / 4". Digits and a slash read the same in
    // both languages.
    const stops = STEPS.filter((s) => !s.intro).length;
    progressEl.textContent = step.intro ? '' : `${index} / ${stops}`;

    const isFirst = index === 0;
    const isLast = index === STEPS.length - 1;
    backBtn.disabled = isFirst;
    nextBtn.textContent = isLast ? t('Fertig') : t('Weiter');

    positionCard(target);
  }

  function onKeydown(e) {
    if (e.key === 'Escape') finish();
  }

  function onResize() {
    const step = STEPS[currentIndex];
    if (!step) return;
    // Passing null re-centres the greeting, which has no panel to sit next to.
    positionCard(step.selector ? document.querySelector(step.selector) : null);
  }

  function finish() {
    markSeen();
    clearHighlight();
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
    if (overlayEl) overlayEl.remove();
    if (cardEl) cardEl.remove();
    overlayEl = null;
    cardEl = null;
    currentIndex = -1;
  }

  function start() {
    // A second start while one is running would leave the first overlay behind.
    if (cardEl) finish();
    build();
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);
    show(0);
  }

  const params = new URLSearchParams(location.search);
  const requested = params.get('tour') === '1';

  if (requested) {
    // Drop the parameter again so a reload doesn't restart the tour.
    history.replaceState(null, '', location.pathname);
  }

  if (requested || !hasSeen()) {
    // After the page's own scripts have set the panels up. The readyState
    // check covers the case where load has already fired by the time this
    // runs, which would otherwise mean the listener never gets called.
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }

  window.DashboardTour = { start };
})();
