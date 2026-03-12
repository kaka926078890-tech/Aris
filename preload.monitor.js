const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitorApi', {
  getTokenUsageRecords: () => ipcRenderer.invoke('monitor:getTokenUsage'),
  getFileModifications: () => ipcRenderer.invoke('monitor:getFileModifications'),
});
