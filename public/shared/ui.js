// Two small UI behaviours that three different scripts had each written for
// themselves: the fade-in/out used by every dropdown-style panel (the gear
// menu, the emote picker, the chatters list, the category suggestions), and
// the toast. Same 140 ms, same requestAnimationFrame trick, same structure —
// three copies that had to be kept in step by hand.
(function () {
  // The panels fade rather than pop, so `hidden` (which removes them from
  // layout, tab order and screen readers) can only be set once the fade-out
  // has actually played. `.is-visible` is therefore the source of truth for
  // "is this open", and `hidden` follows it by this much.
  const TRANSITION_MS = 140;

  const closeTimers = new WeakMap();

  function isPanelOpen(el) {
    return Boolean(el) && el.classList.contains('is-visible');
  }

  function openPanel(el) {
    if (!el) return;
    clearTimeout(closeTimers.get(el));
    el.hidden = false;
    // Adding the class in the same tick as clearing `hidden` gives the
    // browser nothing to transition from — it would just render already
    // "open". One rAF lets the closed state paint first.
    requestAnimationFrame(() => el.classList.add('is-visible'));
  }

  function closePanel(el) {
    if (!el) return;
    // If openPanel() never got a paint (e.g. the window was backgrounded
    // right as it was clicked, stalling the rAF that adds 'is-visible'),
    // returning here without touching `hidden` would leave the panel stuck
    // open — invisible but still swallowing clicks. Closing it for real is
    // always safe, animated or not.
    if (!isPanelOpen(el)) {
      el.hidden = true;
      return;
    }
    el.classList.remove('is-visible');
    closeTimers.set(
      el,
      setTimeout(() => {
        el.hidden = true;
      }, TRANSITION_MS)
    );
  }

  const TOAST_MS = 4000;

  function showToast(text) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));

    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), TRANSITION_MS);
    }, TOAST_MS);
  }

  window.SynsaUI = { isPanelOpen, openPanel, closePanel, showToast, TRANSITION_MS };
})();
