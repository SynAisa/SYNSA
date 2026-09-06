// The three answers of the close dialog, handed to the main process through
// the one function electron/close-dialog-preload.js exposes.
//
// Opened in a browser rather than by SYNSA (which nothing does on purpose,
// but the page is served like any other) that bridge is simply absent — the
// buttons then do nothing instead of throwing.
(function () {
  const rememberInput = document.getElementById('close-remember');
  const bridge = window.SynsaCloseDialog;

  function choose(action) {
    if (!bridge) return;
    bridge.choose(action, rememberInput.checked);
  }

  document.getElementById('close-tray').addEventListener('click', () => choose('tray'));
  document.getElementById('close-quit').addEventListener('click', () => choose('quit'));
  document.getElementById('close-cancel').addEventListener('click', () => choose('cancel'));

  // Escape cancels and Enter takes the default, the way the system dialog
  // this replaces behaved. Enter is ignored while a button has focus so it
  // triggers that button instead of always minimising to the tray.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      choose('cancel');
      return;
    }
    if (event.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) {
      choose('tray');
    }
  });

  // Focus starts on the primary action, so the dialog is operable from the
  // keyboard alone without a first blind Tab.
  document.getElementById('close-tray').focus();
})();
