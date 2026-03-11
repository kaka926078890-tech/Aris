const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptApi', {
  getPreview: (userMessage) => ipcRenderer.invoke('prompt:getPreview', userMessage),
});
