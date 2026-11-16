// Preload: expose the few native capabilities the web UI needs.
// Keep this list intentionally small — everything else goes through the local HTTP API.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mangaDesktop', {
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  pickProjectFile: (title) => ipcRenderer.invoke('pick-project-file', title),
  saveProjectFile: (title, defaultName) => ipcRenderer.invoke('save-project-file', title, defaultName),
  platform: process.platform,
});
