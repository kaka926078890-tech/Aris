const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('historyApi', {
  getSessions: () => ipcRenderer.invoke('history:getSessions'),
  getConversation: (sessionId) => ipcRenderer.invoke('history:getConversation', sessionId),
  clearAll: () => ipcRenderer.invoke('history:clearAll'),
});
