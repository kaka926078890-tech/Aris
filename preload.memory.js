const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoryApi', {
  getStats: () => ipcRenderer.invoke('memory:getStats'),
  list: (params) => ipcRenderer.invoke('memory:list', params || {}),
  semanticSearch: (query, limit) => ipcRenderer.invoke('memory:semanticSearch', { query, limit }),
  reindexFromHistory: () => ipcRenderer.invoke('memory:reindexFromHistory'),
  clearAll: () => ipcRenderer.invoke('memory:clearAll'),
});

