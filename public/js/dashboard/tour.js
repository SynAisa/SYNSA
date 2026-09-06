// Guided tour of the dashboard: compact stops that explain what the panels are
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
  // Versioned on purpose: the number the server hands out (TOUR_VERSION) only
  // goes up when the dashboard has changed enough to be worth explaining
  // again. An ordinary release leaves it alone, so the tour stays gone.
  //
  // This used to live in localStorage, which turned out to be the wrong place:
  // it did not survive updates, so the tour came back after every single one.
  // The server keeps it in data/ui-state.json now, next to everything else
  // that outlives an update. The old key is still read once, so anyone who
  // already dismissed the tour is not greeted again.
  const LEGACY_STORAGE_KEY = 'synsa.dashboardTour.v1';

  // Overwritten by the first /api/ui-state answer. The fallback only matters
  // if the tour is finished before that answer arrives.
  let tourVersion = 1;

  const STEPS = [
    {
      intro: true,
      selector: null,
      title: 'Kurzer Dashboard-Rundgang',
      paragraphs: [
        'In den nächsten Schritten lernst du die wichtigsten Bereiche des Dashboards kennen.',
        'Du kannst den Rundgang jederzeit mit dem X oben rechts schließen.',
      ],
    },
    {
      selector: '#system-status',
      title: 'Systemstatus',
      paragraphs: [
        'Hier siehst du auf einen Blick die Auslastung deines PCs und deiner Verbindung.',
        'Bei einer Warnung öffnet sich der Bereich automatisch. So erkennst du Probleme vor dem Stream rechtzeitig.',
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

  // Only consulted once, to carry an earlier dismissal over into the new
  // storage. Never written to again.
  function dismissedBeforeMove() {
    try {
      return localStorage.getItem(LEGACY_STORAGE_KEY) === 'done';
    } catch {
      // Storage blocked — nothing to carry over.
      return false;
    }
  }

  function markSeen() {
    fetch('/api/ui-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourSeenVersion: tourVersion }),
    }).catch(() => {
      // Not being able to record it only means the tour may appear once more.
    });
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

    const stops = STEPS.filter((candidate) => !candidate.intro).length;
    const completedIntro = STEPS.slice(0, index + 1).filter((candidate) => !candidate.intro).length;
    progressEl.textContent = step.intro ? '' : `${completedIntro} / ${stops}`;

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

  // After the page's own scripts have set the panels up. The readyState check
  // covers the case where load has already fired by the time this runs, which
  // would otherwise mean the listener never gets called.
  function startWhenReady() {
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }

  // On a new installation the login modal deliberately gets the first focus.
  // Wait until its user has connected or explicitly deferred it before the
  // tour starts, so the tour is actually visible rather than running beneath
  // another modal.
  function startAfterLoginModal() {
    const loginReady = window.SynsaLoginModalReady;
    // Let the login modal finish its removal before creating the next dialog.
    // This prevents a one-frame overlap on slower Windows/Electron starts.
    if (loginReady && typeof loginReady.then === 'function') {
      loginReady.then(() => window.setTimeout(startWhenReady, 180));
    }
    else startWhenReady();
  }

  if (requested) {
    startAfterLoginModal();
  } else {
    fetch('/api/ui-state')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // No answer means no decision: showing the tour on a failed request
        // would reopen it every time the server hiccups.
        if (!data) return;
        tourVersion = data.tourVersion;
        if (data.tourSeenVersion >= tourVersion) return;

        // One-time move of the old localStorage flag. Bound to version 1
        // deliberately: a future version 2 is a new tour, and having seen the
        // first one says nothing about it.
        if (tourVersion === 1 && dismissedBeforeMove()) {
          markSeen();
          return;
        }

        startAfterLoginModal();
      })
      .catch(() => {
        // Same reasoning as above — stay quiet.
      });
  }

  window.DashboardTour = { start };
})();
