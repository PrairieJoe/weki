const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wekiCredentials', {
  getStatus: () => ipcRenderer.invoke('weki:credential-status'),
  saveToken: (token) => ipcRenderer.invoke('weki:save-mybox-token', token),
  clearToken: () => ipcRenderer.invoke('weki:clear-mybox-token'),
});

contextBridge.exposeInMainWorld('wekiAiCredentials', {
  saveGeminiKey: (apiKey) => ipcRenderer.invoke('weki:save-gemini-key', apiKey),
  clearGeminiKey: () => ipcRenderer.invoke('weki:clear-gemini-key'),
  getGeminiStatus: () => ipcRenderer.invoke('weki:gemini-credential-status'),
});

contextBridge.exposeInMainWorld('wekiApp', {
  restart: () => ipcRenderer.invoke('weki:restart'),
  focusWindow: () => ipcRenderer.invoke('weki:focus-window'),
  reportSearchInput: (payload) => ipcRenderer.send('weki:search-input-event', payload),
  watchRuntimeInstall: (startedAt) => ipcRenderer.invoke('weki:watch-runtime-install', startedAt),
  cancelRuntimeInstallWatch: () => ipcRenderer.invoke('weki:cancel-runtime-install-watch'),
});
