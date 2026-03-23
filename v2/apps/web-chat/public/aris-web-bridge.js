/**
 * 浏览器内模拟 Electron preload 的 window.aris，通过 web-chat 同源 API 通信。
 */
(function () {
  const chunkListeners = [];
  const actionListeners = [];

  function authHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('aris_web_chat_bearer') : '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  /** GET 下载等不需要 JSON Content-Type */
  function authHeadersBare() {
    const headers = {};
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('aris_web_chat_bearer') : '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  /** 仅 http(s) 页用绝对 URL，避免异常 base；file:// 等仍走相对路径 */
  function httpOriginPrefix() {
    if (typeof window === 'undefined' || !window.location) return '';
    const p = window.location.protocol || '';
    if (p !== 'http:' && p !== 'https:') return '';
    return String(window.location.origin || '').replace(/\/$/, '');
  }

  async function rpc(method, args) {
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ method, args: args || [] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'rpc ' + res.status);
    return data.result;
  }

  window.aris = {
    setIgnoreMouseEvents() {},

    minimizeWindow() {},

    closeWindow() {},

    onProactive() {
      /* Web 模式无 Electron 定时主动消息 */
    },

    onDialogueChunk(callback) {
      chunkListeners.push(callback);
      return () => {
        const i = chunkListeners.indexOf(callback);
        if (i >= 0) chunkListeners.splice(i, 1);
      };
    },

    onAgentActions(callback) {
      actionListeners.push(callback);
      return () => {
        const i = actionListeners.indexOf(callback);
        if (i >= 0) actionListeners.splice(i, 1);
      };
    },

    async sendMessage(text) {
      const res = await fetch('/api/dialogue/send', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text: String(text || '') }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'HTTP ' + res.status);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch (_) {
            continue;
          }
          if (msg.type === 'chunk' && msg.data != null) {
            chunkListeners.forEach((fn) => {
              try {
                fn(msg.data);
              } catch (_) {}
            });
          }
          if (msg.type === 'agentActions' && msg.data != null) {
            actionListeners.forEach((fn) => {
              try {
                fn(msg.data);
              } catch (_) {}
            });
          }
          if (msg.type === 'done') finalResult = msg.result;
        }
      }
      return finalResult != null ? finalResult : { error: true, content: '' };
    },

    async abortDialogue() {
      await fetch('/api/dialogue/abort', { method: 'POST', headers: authHeaders() }).catch(() => {});
    },

    getPromptPreview(userMessage) {
      return rpc('prompt:getPreview', [userMessage]);
    },
    getSessions() {
      return rpc('history:getSessions', []);
    },
    getCurrentSessionId() {
      return rpc('history:getCurrentSessionId', []);
    },
    getConversation(sessionId) {
      return rpc('history:getConversation', [sessionId]);
    },
    clearAllConversations() {
      return rpc('history:clearAll', []);
    },
    vectorSearch(query, limit) {
      return rpc('vector:search', [query, limit]);
    },
    vectorGetRecent(type, limit) {
      return rpc('vector:getRecent', [type, limit]);
    },
    getTokenUsageRecords() {
      return rpc('monitor:getTokenUsageRecords', []);
    },
    getFileModifications() {
      return rpc('monitor:getFileModifications', []);
    },
    getIdentity() {
      return rpc('content:getIdentity', []);
    },
    writeIdentity(data) {
      return rpc('content:writeIdentity', [data]);
    },
    getRequirements(limit) {
      return rpc('content:getRequirements', [limit]);
    },
    writeRequirements(list) {
      return rpc('content:writeRequirements', [list]);
    },
    writeRequirementsAsDocument(doc) {
      return rpc('content:writeRequirementsAsDocument', [doc]);
    },
    triggerRequirementsRefinement() {
      return rpc('content:triggerRequirementsRefinement', []);
    },
    triggerRefinementAsDocument(category) {
      return rpc('content:triggerRefinementAsDocument', [category]);
    },
    getState() {
      return rpc('content:getState', []);
    },
    getProactiveState() {
      return rpc('content:getProactiveState', []);
    },
    getEmotionsRecent(limit) {
      return rpc('content:getEmotionsRecent', [limit]);
    },
    getExpressionDesiresRecent(limit) {
      return rpc('content:getExpressionDesiresRecent', [limit]);
    },
    getCorrectionsRecent(limit) {
      return rpc('content:getCorrectionsRecent', [limit]);
    },
    getCorrectionsAll() {
      return rpc('content:getCorrectionsAll', []);
    },
    writeCorrections(list) {
      return rpc('content:writeCorrections', [list]);
    },
    writeCorrectionsAsDocument(doc) {
      return rpc('content:writeCorrectionsAsDocument', [doc]);
    },
    getPreferences() {
      return rpc('content:getPreferences', []);
    },
    writePreferences(list) {
      return rpc('content:writePreferences', [list]);
    },
    writePreferencesAsDocument(doc) {
      return rpc('content:writePreferencesAsDocument', [doc]);
    },
    getAvoidPhrases() {
      return rpc('content:getAvoidPhrases', []);
    },
    setAvoidPhrases(phrases) {
      return rpc('content:setAvoidPhrases', [phrases]);
    },
    getRuntimeConfig() {
      return rpc('config:get', []);
    },
    setRuntimeConfig(data) {
      return rpc('config:set', [data]);
    },
    getOllamaStatus() {
      return rpc('ollama:status', []);
    },
    ensureOllama() {
      return rpc('ollama:ensure', []);
    },

    /**
     * 导入另一台机器导出的 .aris（与 Electron「文件 → 导入全部数据」相同）。
     * @param {File} file
     */
    async importArisBackup(file) {
      if (!file || typeof file.text !== 'function') {
        throw new Error('请选择有效的 .aris 文件');
      }
      const text = await file.text();
      const url = httpOriginPrefix() + '/api/backup/import';
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const parts = [data.error || data.detail || '导入失败 ' + res.status];
        if (data.hint) parts.push(data.hint);
        else if (res.status === 404)
          parts.push('多为未重启 web-chat：请在运行 npm run web-chat 的终端 Ctrl+C 后重新启动。');
        throw new Error(parts.filter(Boolean).join(' — '));
      }
      return data;
    },

    /**
     * 合并导入另一台机器导出的 .aris：只 merge 向量记忆与历史对话，避免覆盖。
     * @param {File} file
     */
    async importArisMergeBackup(file) {
      if (!file || typeof file.text !== 'function') {
        throw new Error('请选择有效的 .aris 文件');
      }
      const text = await file.text();
      const url = httpOriginPrefix() + '/api/backup/merge_import';
      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const parts = [data.error || data.detail || '合并导入失败 ' + res.status];
        if (data.hint) parts.push(data.hint);
        else if (res.status === 404)
          parts.push('多为未重启 web-chat：请在运行 npm run web-chat 的终端 Ctrl+C 后重新启动。');
        throw new Error(parts.filter(Boolean).join(' — '));
      }
      return data;
    },

    /** 下载当前数据目录的完整备份为 .aris */
    async exportArisBackup() {
      const res = await fetch(httpOriginPrefix() + '/api/backup/export', { headers: authHeadersBare() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '导出失败 ' + res.status);
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename="?([^";]+)"?/i);
      const name = m ? m[1] : `aris-v2-backup-${new Date().toISOString().slice(0, 10)}.aris`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return { ok: true };
    },
  };
})();
