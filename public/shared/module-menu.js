// Shared gear-icon flyout menu mounted into <div id="module-menu-root"></div>
// on every page (Dashboard, Control-Panel, Music-Settings, ...). Adding a
// module just means adding an entry to MODULES below.
(function () {
  // A proper multi-tooth gear with a hollow center (the well-known Feather
  // "settings" glyph) — the earlier hand-drawn 6-bump path looked soft and
  // under-detailed at 18px; this one has cleaner, more precise geometry.
  const GEAR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>';

  const BACK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5 7 12l7.5 7"/></svg>';
  const FORWARD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5 17 12l-7.5 7"/></svg>';

  const MODULES = [
    {
      label: 'Dashboard',
      href: '/dashboard.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/></svg>',
    },
    {
      label: 'Music-Overlay',
      href: '/music-settings.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5.5L20 4v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16.5" r="2.5"/></svg>',
    },
    {
      label: 'Countdown',
      href: '/countdown-settings.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2.5h5"/><path d="M18.5 5.5 20 4"/></svg>',
    },
    {
      label: 'Ziel',
      href: '/goal-settings.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4V2"/></svg>',
    },
    {
      label: 'Testbereich (in Überarbeitung)',
      href: '/control.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>',
    },
  ];

  // Below the separator, apart from the modules: these two are about SYNSA
  // itself rather than a thing you stream with.
  const FOOTER_MODULES = [
    {
      label: 'Einstellungen',
      href: '/settings.html',
      icon: GEAR_ICON,
    },
    {
      label: 'Diagnose',
      href: '/diagnostics.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12L16 12h5"/></svg>',
    },
    {
      label: 'Über SYNSA',
      href: '/about.html',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.75v.5"/></svg>',
    },
  ];

  const root = document.getElementById('module-menu-root');
  if (!root) return;

  const currentPath = location.pathname;

  const renderItems = (entries) =>
    entries
      .map((m) => {
        const active = m.href === currentPath ? ' is-active' : '';
        return `<a href="${m.href}" class="module-menu-item${active}">${m.icon}<span>${m.label}</span></a>`;
      })
      .join('');

  root.innerHTML = `
    <div class="nav-controls">
      <button type="button" class="nav-arrow-btn" id="nav-back-btn" title="Zurück" aria-label="Zurück">${BACK_ICON}</button>
      <button type="button" class="nav-arrow-btn" id="nav-forward-btn" title="Vorwärts" aria-label="Vorwärts">${FORWARD_ICON}</button>
      <div class="module-menu">
        <button type="button" class="module-menu-btn" id="module-menu-btn" title="Module" aria-label="Module">${GEAR_ICON}</button>
        <div class="module-menu-flyout" id="module-menu-flyout" hidden>
          ${renderItems(MODULES)}
          <div class="module-menu-separator"></div>
          ${renderItems(FOOTER_MODULES)}
          <div class="module-menu-version" id="module-menu-version"></div>
        </div>
      </div>
    </div>
  `;

  // This markup is built after shared/i18n.js has already walked the page, so
  // it translates its own subtree rather than staying German in an otherwise
  // English window.
  window.SynsaI18n.translateTree(root);

  // Every page is a plain server-rendered navigation (a normal <a href>, or
  // the tray's loadURL()) — both feed the browser's own history stack, so
  // Back/Forward need nothing beyond what the platform already tracks.
  // There's no standard way to ask "is there anything to go back to", so at
  // the very start/end of history these are just harmless no-ops rather
  // than disabled.
  document.getElementById('nav-back-btn').addEventListener('click', () => history.back());
  document.getElementById('nav-forward-btn').addEventListener('click', () => history.forward());

  const btn = document.getElementById('module-menu-btn');
  const flyout = document.getElementById('module-menu-flyout');
  const versionEl = document.getElementById('module-menu-version');

  // Reads package.json via the server rather than hardcoding the number
  // here, so there is exactly one place (package.json) to bump on release.
  fetch('/api/version')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.version) versionEl.textContent = `SYNSA v${data.version}`;
    })
    .catch(() => {
      // Not critical — the menu still works without the version line.
    });

  // The open/close fade is shared with the dashboard's popovers and lives in
  // shared/ui.js.
  const { isPanelOpen, openPanel, closePanel } = window.SynsaUI;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isPanelOpen(flyout)) closePanel(flyout);
    else openPanel(flyout);
  });

  document.addEventListener('click', (e) => {
    if (isPanelOpen(flyout) && !e.target.closest('.module-menu')) closePanel(flyout);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPanelOpen(flyout)) {
      closePanel(flyout);
      btn.focus();
    }
  });
})();
