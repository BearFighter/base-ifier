// Preload: the only bridge between the web app and the Electron main process.
// Kept CommonJS (.cjs) so it loads in the sandboxed renderer regardless of the
// package's "type": "module". Everything here is exposed as window.baseifierDesktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('baseifierDesktop', {
  version: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', String(url)),
  onUpdate: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('updates:state', handler);
    return () => ipcRenderer.removeListener('updates:state', handler);
  },
});
