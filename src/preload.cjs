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
});
