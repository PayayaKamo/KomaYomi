// Preload: expose the few native capabilities the web UI needs.
// Keep this list intentionally small — everything else goes through the local HTTP API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mangaDesktop', {
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  platform: process.platform,
});
