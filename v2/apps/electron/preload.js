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
  vectorSearch: (query, limit) => ipcRenderer.invoke('vector:search', query, limit),
  vectorGetRecent: (type, limit) => ipcRenderer.invoke('vector:getRecent', type, limit),
  getTokenUsageRecords: () => ipcRenderer.invoke('monitor:getTokenUsageRecords'),
  getFileModifications: () => ipcRenderer.invoke('monitor:getFileModifications'),
  getIdentity: () => ipcRenderer.invoke('content:getIdentity'),
  writeIdentity: (data) => ipcRenderer.invoke('content:writeIdentity', data),
  getRequirements: (limit) => ipcRenderer.invoke('content:getRequirements', limit),
  writeRequirements: (list) => ipcRenderer.invoke('content:writeRequirements', list),
  writeRequirementsAsDocument: (doc) => ipcRenderer.invoke('content:writeRequirementsAsDocument', doc),
  triggerRequirementsRefinement: () => ipcRenderer.invoke('content:triggerRequirementsRefinement'),
  triggerRefinementAsDocument: (category) => ipcRenderer.invoke('content:triggerRefinementAsDocument', category),
  getState: () => ipcRenderer.invoke('content:getState'),
  getProactiveState: () => ipcRenderer.invoke('content:getProactiveState'),
  getEmotionsRecent: (limit) => ipcRenderer.invoke('content:getEmotionsRecent', limit),
  getExpressionDesiresRecent: (limit) => ipcRenderer.invoke('content:getExpressionDesiresRecent', limit),
  getCorrectionsRecent: (limit) => ipcRenderer.invoke('content:getCorrectionsRecent', limit),
  getCorrectionsAll: () => ipcRenderer.invoke('content:getCorrectionsAll'),
  writeCorrections: (list) => ipcRenderer.invoke('content:writeCorrections', list),
  writeCorrectionsAsDocument: (doc) => ipcRenderer.invoke('content:writeCorrectionsAsDocument', doc),
  getPreferences: () => ipcRenderer.invoke('content:getPreferences'),
  writePreferences: (list) => ipcRenderer.invoke('content:writePreferences', list),
  writePreferencesAsDocument: (doc) => ipcRenderer.invoke('content:writePreferencesAsDocument', doc),
  getAvoidPhrases: () => ipcRenderer.invoke('content:getAvoidPhrases'),
  setAvoidPhrases: (phrases) => ipcRenderer.invoke('content:setAvoidPhrases', phrases),
  getRuntimeConfig: () => ipcRenderer.invoke('config:get'),
  setRuntimeConfig: (data) => ipcRenderer.invoke('config:set', data),
  getOllamaStatus: () => ipcRenderer.invoke('ollama:status'),
  ensureOllama: () => ipcRenderer.invoke('ollama:ensure'),
});
