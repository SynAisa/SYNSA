// Renders the release history into a container element.
//
// Used by the welcome screen (which shows it once after an update) and by
// "Über SYNSA" in the settings, so the changelog stays reachable for anyone
// who clicked past the welcome screen too quickly. Both render the identical
// list from the identical source — GitHub's releases, via /api/changelog.
//
// Release bodies are written on GitHub and are inserted as text only, never
// as markup.
(function () {
  function formatDate(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    return isNaN(date) ? '' : date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // The welcome screen appears right after an update and answers exactly one
  // question: what changed in the version that was just installed. The full
  // history there pushed that answer off the top of a small window and made
  // every release look alike. "Über SYNSA" keeps the complete list.
  //
  // Falls back to the newest entry when the installed version has no release
  // of its own (a local build, or GitHub not reachable yet) — an empty box
  // would be worse than the closest thing available.
  function selectEntries(data, onlyCurrent) {
    const entries = (data && data.entries) || [];
    if (!onlyCurrent || entries.length === 0) return entries;
    const current = entries.find((entry) => entry.version === data.currentVersion);
    return [current || entries[0]];
  }

  function renderEntries(container, data, onlyCurrent) {
    const entries = selectEntries(data, onlyCurrent);

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'changelog-empty';
      empty.textContent =
        data && data.unavailable
          ? t('Die Änderungen konnten gerade nicht geladen werden.')
          : t('Noch keine Änderungen veröffentlicht.');
      container.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const entry of entries) {
      const article = document.createElement('article');
      article.className = 'changelog-entry';

      const head = document.createElement('div');
      head.className = 'changelog-entry-head';

      const version = document.createElement('span');
      version.className = 'changelog-entry-version';
      version.textContent = entry.version;
      head.appendChild(version);

      if (data.currentVersion && entry.version === data.currentVersion) {
        const badge = document.createElement('span');
        badge.className = 'changelog-entry-current';
        badge.textContent = t('installiert');
        head.appendChild(badge);
      }

      if (entry.preview) {
        const preview = document.createElement('span');
        preview.className = 'changelog-entry-preview';
        preview.textContent = t('Vorschau');
        head.appendChild(preview);
      }

      const date = formatDate(entry.publishedAt);
      if (date) {
        const dateEl = document.createElement('span');
        dateEl.className = 'changelog-entry-date';
        dateEl.textContent = date;
        head.appendChild(dateEl);
      }

      article.appendChild(head);

      const list = document.createElement('ul');
      list.className = 'changelog-list';
      for (const line of entry.notes || []) {
        const item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      }
      if (list.childElementCount > 0) article.appendChild(list);

      fragment.appendChild(article);
    }

    container.replaceChildren(fragment);
  }

  // Fetches and renders. A failed request renders the same quiet "not
  // available" line as an empty list — no changelog is never worth an error
  // dialog on a page the user came to for something else.
  window.loadChangelog = function loadChangelog(container, { onlyCurrent = false } = {}) {
    if (!container) return Promise.resolve();

    return fetch('/api/changelog')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data) => renderEntries(container, data, onlyCurrent));
  };
})();
