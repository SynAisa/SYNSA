// Preload for the close dialog window only.
//
// That window loads a page from SYNSA's own loopback server, exactly like
// every other page, so it has no Node access and no IPC of its own. This
// exposes one function and nothing else: the dialog's answer. Everything the
// dialog can express — which button, and whether to remember it — goes
// through this single call, so the page cannot reach anything in the main
// process beyond it.
const { contextBridge, ipcRenderer } = require('electron');

const ACTIONS = ['tray', 'quit', 'cancel'];

contextBridge.exposeInMainWorld('SynsaCloseDialog', {
  choose(action, remember) {
    if (!ACTIONS.includes(action)) return;
    ipcRenderer.send('close-dialog:choice', { action, remember: Boolean(remember) });
  },
});
