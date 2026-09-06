// The drag handle between Alert Box and Chat.
//
// Deliberately the smallest thing that answers "I want more room for the
// chat": the two panels keep their places and keep filling the window, only
// the share between them changes. Nothing here positions or resizes a panel
// directly — it writes the two CSS variables .columns is built on, so the
// layout stays a grid and every rule that depends on it (the one-column
// fallback below 800px included) keeps working untouched.
//
// The chosen share is stored on the server rather than in localStorage, for
// the same reason the guided tour moved there: localStorage does not survive
// an update, and a layout that silently resets itself every few weeks is
// worse than none at all.
(function () {
  const columns = document.querySelector('.columns');
  const splitter = document.getElementById('columns-splitter');
  if (!columns || !splitter) return;

  // The left column is the Alert Box. DEFAULT_SHARE is the 1fr of the
  // original "1fr 1.4fr" expressed as a fraction, so "reset" really does go
  // back to the layout SYNSA has always started with.
  const DEFAULT_SHARE = 1 / 2.4;
  const MIN_SHARE = 0.2;
  const MAX_SHARE = 0.8;
  const KEYBOARD_STEP = 0.02;

  const clamp = (value) => Math.min(MAX_SHARE, Math.max(MIN_SHARE, value));

  let share = DEFAULT_SHARE;

  function apply(next) {
    share = clamp(next);
    columns.style.setProperty('--col-left', `${share}fr`);
    columns.style.setProperty('--col-right', `${1 - share}fr`);
    splitter.setAttribute('aria-valuenow', Math.round(share * 100));
  }

  // Coalesced: dragging fires a pointermove per frame, and every one of them
  // would otherwise be a request.
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fetch('/api/ui-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layoutColumns: share }),
      }).catch(() => {
        // A layout that fails to save is not worth interrupting anyone over;
        // it simply comes back at its previous width next time.
      });
    }, 400);
  }

  function shareFromPointer(clientX) {
    const rect = columns.getBoundingClientRect();
    if (rect.width === 0) return share;
    return (clientX - rect.left) / rect.width;
  }

  splitter.addEventListener('pointerdown', (event) => {
    // Pointer capture rather than window-level listeners: the handle keeps
    // receiving moves even when the pointer races ahead of it over a panel.
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add('is-dragging');
    document.body.classList.add('is-resizing-columns');
    event.preventDefault();
  });

  splitter.addEventListener('pointermove', (event) => {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    apply(shareFromPointer(event.clientX));
  });

  function endDrag(event) {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    splitter.releasePointerCapture(event.pointerId);
    splitter.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing-columns');
    save();
  }

  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);

  splitter.addEventListener('dblclick', () => {
    apply(DEFAULT_SHARE);
    save();
  });

  splitter.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') apply(share - KEYBOARD_STEP);
    else if (event.key === 'ArrowRight') apply(share + KEYBOARD_STEP);
    else if (event.key === 'Home') apply(DEFAULT_SHARE);
    else return;
    event.preventDefault();
    save();
  });

  fetch('/api/ui-state')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && typeof data.layoutColumns === 'number') apply(data.layoutColumns);
    })
    .catch(() => {
      // Nothing stored, or nothing reachable — the CSS defaults already apply.
    });
})();
