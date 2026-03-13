const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aris', {
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  sendMessage: (text) => ipcRenderer.invoke('dialogue:send', text),
  abortDialogue: () => ipcRenderer.invoke('dialogue:abort'),
  onDialogueChunk: (callback) => {
    const handler = (_, chunk) => callback(chunk);
    ipcRenderer.on('dialogue:chunk', handler);
    return () => ipcRenderer.removeListener('dialogue:chunk', handler);
  },
  onAgentActions: (callback) => {
    const handler = (_, actions) => callback(actions);
    ipcRenderer.on('dialogue:agentActions', handler);
    return () => ipcRenderer.removeListener('dialogue:agentActions', handler);
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onProactive: (callback) => {
    ipcRenderer.on('aris:proactive', (_, msg) => callback(msg));
  },
  getPromptPreview: (userMessage) => ipcRenderer.invoke('prompt:getPreview', userMessage),
  getSessions: () => ipcRenderer.invoke('history:getSessions'),
  getCurrentSessionId: () => ipcRenderer.invoke('history:getCurrentSessionId'),
  getConversation: (sessionId) => ipcRenderer.invoke('history:getConversation', sessionId),
  clearAllConversations: () => ipcRenderer.invoke('history:clearAll'),
});
