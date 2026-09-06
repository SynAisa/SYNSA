// Interface language.
//
// German is SYNSA's source language and stays written out in the HTML and in
// the scripts — new features are built in German first, and nothing has to be
// replaced by a key to be translatable later. English is a layer on top: a
// table that maps the German wording to its English equivalent. Anything
// missing from that table simply stays German, which is exactly the behaviour
// wanted while a translation is still catching up.
//
// Because the German text *is* the key, translating a page needs no markup:
// the walker below replaces text it recognises and leaves everything else
// alone. Content that is not interface text — chat messages, viewer names,
// the release notes — lives in the containers listed in SKIP_CONTAINERS and
// is never touched, so a viewer called "Trennen" cannot be renamed.
//
// The choice is read from localStorage because that read has to be
// synchronous — every page shares the same window, and a round trip here
// would flash German before switching. It is mirrored to the server as well:
// localStorage turned out not to survive an update, so data/ui-state.json is
// what actually carries the choice across one. See syncWithServer below.
(function () {
  const STORAGE_KEY = 'synsa.language';
  const DEFAULT_LANGUAGE = 'de';
  const SUPPORTED = ['de', 'en'];

  // Elements whose content comes from Twitch, from GitHub or from the user.
  const SKIP_CONTAINERS = [
    '#chat-messages',
    '#history-list',
    '#chatters-list',
    '#changelog-box',
    '#emote-picker-list',
    '#category-results',
    '#device-code',
    '.reveal-copy',
  ];

  function getLanguage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(stored) ? stored : DEFAULT_LANGUAGE;
    } catch {
      // Private mode or blocked storage — German is the source language, so
      // falling back to it is always safe.
      return DEFAULT_LANGUAGE;
    }
  }

  // localStorage stays the one the page reads, because that read has to be
  // synchronous — a fetch here would show German for a moment on every single
  // page load. But it does not survive an update (the same defect that kept
  // restarting the guided tour), so the choice is mirrored into data/ on the
  // server and restored from there when the local copy is gone.
  function rememberOnServer(language) {
    return fetch('/api/ui-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language }),
    }).catch(() => {
      // Losing the mirror only costs the language after the next update.
    });
  }

  function setLanguage(language) {
    if (!SUPPORTED.includes(language)) return Promise.reject(new Error(`Unbekannte Sprache: ${language}`));
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch (err) {
      return Promise.reject(err);
    }
    rememberOnServer(language);
    return Promise.resolve(language);
  }

  // Runs once per page load, after the page has already been translated with
  // whatever the local copy said.
  //
  // The restore reloads, because the table is chosen at load time and half a
  // page cannot be re-translated into a language it never had. That reload
  // can happen at most once per install — right after an update — and only
  // for someone who actually chose English, so it is not a cost anyone pays
  // twice. RELOAD_GUARD makes sure of that even if the write fails.
  const RELOAD_GUARD = 'synsa.language.restored';

  function syncWithServer(localValue) {
    fetch('/api/ui-state')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;

        if (localValue) {
          // Local wins: it is what the user is looking at right now.
          if (data.language !== localValue) rememberOnServer(localValue);
          return;
        }

        if (!SUPPORTED.includes(data.language) || data.language === DEFAULT_LANGUAGE) return;

        try {
          if (sessionStorage.getItem(RELOAD_GUARD)) return;
          sessionStorage.setItem(RELOAD_GUARD, '1');
          localStorage.setItem(STORAGE_KEY, data.language);
        } catch {
          // Without storage there is nothing to restore into, and reloading
          // would loop.
          return;
        }
        location.reload();
      })
      .catch(() => {
        // Nothing to sync against; the local copy keeps working.
      });
  }

  // The raw stored value, or null when nothing is stored — which is what
  // syncWithServer needs to tell "chose German" from "chose nothing".
  function storedLanguage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  const language = getLanguage();
  const table = language === 'en' ? window.SynsaTranslationsEn || {} : null;

  // Text in the HTML is indented and wrapped across lines, so the same
  // sentence reaches this as "Alles, was\n        sich einstellen lässt".
  // Collapsing runs of whitespace lets the table be written as plain
  // sentences instead of having to mirror the indentation of the markup.
  const normalize = (text) => text.trim().replace(/\s+/g, ' ');

  // Translates a single string. Used for text the scripts build themselves —
  // status lines, error messages, anything not already in the HTML. Unknown
  // strings are returned unchanged, i.e. they stay German.
  function t(text) {
    if (!table || typeof text !== 'string') return text;
    return table[text] || table[normalize(text)] || text;
  }

  function translateAttributes(el) {
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const translated = t(value);
      if (translated !== value) el.setAttribute(attr, translated);
    }
  }

  function shouldSkip(node) {
    const el = node.parentElement;
    if (!el) return true;
    return SKIP_CONTAINERS.some((selector) => el.closest(selector));
  }

  function translateTree(root) {
    if (!table) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const pending = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const raw = node.nodeValue;
      if (!raw || !raw.trim()) continue;
      if (shouldSkip(node)) continue;

      const key = normalize(raw);
      const translated = t(key);
      if (translated !== key) pending.push([node, raw, translated]);
    }

    // Collected first, replaced after: editing text while the walker is still
    // traversing it invalidates the walk.
    for (const [node, raw, translated] of pending) {
      // Keep the surrounding padding, so text that sits inline next to a link
      // does not lose the space before or after it.
      const leading = raw.match(/^\s*/)[0];
      const trailing = raw.match(/\s*$/)[0];
      node.nodeValue = leading + translated + trailing;
    }

    root.querySelectorAll('[title], [placeholder], [aria-label]').forEach(translateAttributes);
  }

  function apply() {
    document.documentElement.lang = language;
    if (table) translateTree(document.body);
  }

  window.SynsaI18n = { getLanguage, setLanguage, t, apply, translateTree };
  // Short alias, so scripts read as t('…') like everywhere else.
  window.t = t;

  // The scripts sit at the end of <body>, so the DOM is already parsed here
  // and this runs before the page has had a chance to be interacted with.
  apply();

  syncWithServer(storedLanguage());
})();
