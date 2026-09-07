const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wekiCredentials', {
  getStatus: () => ipcRenderer.invoke('weki:credential-status'),
  saveToken: (token) => ipcRenderer.invoke('weki:save-mybox-token', token),
  clearToken: () => ipcRenderer.invoke('weki:clear-mybox-token'),
});
