/**
 * 主进程入口。仅在此处加载 electron 与 dotenv，其余模块在 app.whenReady() 内加载，
 * 避免启动阶段加载路径触发 macOS 上 SIGBUS。
 */
require('dotenv').config({
  path: require('path').join(__dirname, '..', '..', '.env'),
  override: true,
});
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');

let mainWindow = null;
let createWindowFn = null;

app.whenReady().then(() => {
  const path = require('path');
  const fs = require('fs');
  const { loadAndApplyRuntimeConfig, readConfig, writeConfig, getDataDir } = require('./runtimeConfig.js');
  loadAndApplyRuntimeConfig();

  const { handleUserMessage, getPromptPreview, maybeProactiveMessage } = require('../../packages/server');
  const { exportToFile, importFromFile } = require('./backup.js');
  const store = require('../../packages/store');
  const { resolveRendererIndexPath, PRELOAD_SCRIPT } = require('./config.js');
  const { ensureOllamaStarted, getOllamaStatus } = require('./ollama.js');

  // 默认值
  const DEFAULT_PROACTIVE_INTERVAL_MS = 3 * 60 * 1000;
  const DEFAULT_PROACTIVE_IDLE_MS = 2 * 60 * 1000;
  
  let dialogueBusy = false;
  let dialogueAbortController = null;
  /** 当前轮结束时 resolve，供「新消息在忙时到达」等待后再起新轮 */
  let resolveCurrentDialogue = null;
  let lastDialogueAt = 0;
  let proactiveTimer = null;
  /** proactive 正在执行时的 Promise，供 dialogue:send 等待，避免对话与主动发话并发导致工具/会话被打断 */
  let proactivePromise = null;
  let resolveProactive = null;

  function readProactiveConfig() {
    try {
      const { getProactiveConfigPath } = require('../../packages/config/paths.js');
      const p = getProactiveConfigPath();
      if (!fs.existsSync(p)) {
        return {
          timer_enabled: true,
          timer_interval_minutes: 3,
          timer_idle_minutes: 2,
        };
      }
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return {
        timer_enabled: Boolean(data.timer_enabled ?? true),
        timer_interval_minutes: Math.min(60, Math.max(1, Number(data.timer_interval_minutes) ?? 3)),
        timer_idle_minutes: Math.min(30, Math.max(0, Number(data.timer_idle_minutes) ?? 2)),
      };
    } catch (_) {
      return {
        timer_enabled: true,
        timer_interval_minutes: 3,
        timer_idle_minutes: 2,
      };
    }
  }

  function getProactiveIntervalMs() {
    const config = readProactiveConfig();
    if (!config.timer_enabled) return 0; // 0 表示不启动定时器
    return config.timer_interval_minutes * 60 * 1000;
  }

  function getProactiveIdleMs() {
    const config = readProactiveConfig();
    return config.timer_idle_minutes * 60 * 1000;
  }

  function createWindow() {
    const isMac = process.platform === 'darwin';
    mainWindow = new BrowserWindow({
      width: 480,
      height: 640,
      titleBarStyle: isMac ? 'hiddenInset' : undefined,
      webPreferences: {
        preload: PRELOAD_SCRIPT,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    mainWindow.loadFile(resolveRendererIndexPath());

    mainWindow.on('closed', () => { mainWindow = null; });
    setupAppMenu();
  }

  function setupAppMenu() {
    const isMac = process.platform === 'darwin';
    const template = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }] : []),
      {
        label: '文件',
        submenu: [
          {
            label: '导出全部数据',
            click: async () => {
              const { filePath } = await dialog.showSaveDialog(mainWindow, {
                defaultPath: `aris-v2-backup-${new Date().toISOString().slice(0, 10)}.aris`,
                filters: [{ name: 'Aris 备份', extensions: ['aris'] }],
              });
              if (filePath) {
                try {
                  const r = await exportToFile(filePath);
                  const parts = [`已导出到 ${filePath}`];
                  if (r.memoryCount != null) parts.push(`向量 ${r.memoryCount} 条`);
                  if (r.hasConversations) parts.push('对话');
                  if (r.hasIdentity) parts.push('用户信息');
                  dialog.showMessageBox(mainWindow, { type: 'info', title: '导出成功', message: parts.join('，') + '。回家后可用「导入全部数据」一键恢复。' });
                } catch (e) {
                  dialog.showErrorBox('导出失败', e.message);
                }
              }
            },
          },
          {
            label: '导入全部数据',
            click: async () => {
              const { filePaths } = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: [{ name: 'Aris 备份', extensions: ['aris'] }],
              });
              if (filePaths && filePaths[0]) {
                try {
                  await importFromFile(filePaths[0]);
                  dialog.showMessageBox(mainWindow, { type: 'info', title: '导入成功', message: '对话、向量记忆、用户信息、状态与监控等已恢复。建议重启应用后查看。' });
                } catch (e) {
                  dialog.showErrorBox('导入失败', e.message);
                }
              }
            },
          },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
    ];
    if (!isMac) {
      const fileMenu = template.find((m) => m.label === '文件');
      if (fileMenu && fileMenu.submenu) fileMenu.submenu.push({ type: 'separator' }, { label: '退出', role: 'quit' });
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function serializeVectorRow(r) {
    return {
      text: r.text != null ? String(r.text) : '',
      type: r.type != null ? String(r.type) : '',
      created_at: r.created_at,
    };
  }

  function registerIpcHandlers() {
    ipcMain.handle('dialogue:send', async (event, userContent) => {
      if (dialogueBusy) {
        if (dialogueAbortController) dialogueAbortController.abort();
        await new Promise((resolve) => { resolveCurrentDialogue = resolve; });
      }
      if (proactivePromise) {
        await proactivePromise;
      }
      dialogueBusy = true;
      dialogueAbortController = new AbortController();
      const sendChunk = (chunk) => {
        if (event.sender && !event.sender.isDestroyed()) event.sender.send('dialogue:chunk', chunk);
      };
      const sendAgentActions = (actions) => {
        if (event.sender && !event.sender.isDestroyed()) event.sender.send('dialogue:agentActions', actions);
      };
      try {
        const result = await handleUserMessage(userContent, sendChunk, sendAgentActions, dialogueAbortController.signal);
        lastDialogueAt = Date.now();
        return result;
      } catch (e) {
        console.error('[Aris v2] dialogue:send 异常', e?.message || e);
        return { error: String(e?.message || e) };
      } finally {
        dialogueAbortController = null;
        dialogueBusy = false;
        if (resolveCurrentDialogue) {
          resolveCurrentDialogue();
          resolveCurrentDialogue = null;
        }
      }
    });

    ipcMain.handle('dialogue:abort', () => {
      if (dialogueAbortController) dialogueAbortController.abort();
    });

    ipcMain.handle('window:minimize', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    });

    ipcMain.handle('window:close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });

    ipcMain.handle('prompt:getPreview', async (_, userMessage) => {
      return getPromptPreview(userMessage);
    });

    ipcMain.handle('history:getSessions', async () => {
      return store.conversations.getAllSessions();
    });

    ipcMain.handle('history:getCurrentSessionId', async () => {
      return store.conversations.getCurrentSessionId();
    });

    ipcMain.handle('history:getConversation', async (_, sessionId) => {
      return store.conversations.getAllForSession(sessionId);
    });

    ipcMain.handle('history:clearAll', async () => {
      await store.conversations.clearAllConversations();
    });

    ipcMain.handle('vector:search', async (_, query, limit) => {
      if (!store.vector) return [];
      const rows = await store.vector.search(String(query || ''), Number(limit) || 10);
      return rows.map((r) => ({ ...serializeVectorRow(r), _score: Number(r._score) || 0 }));
    });

    ipcMain.handle('vector:getRecent', async (_, type, limit) => {
      if (!store.vector) return [];
      const rows = await store.vector.getRecentByType(String(type || 'dialogue_turn'), Number(limit) || 50);
      return rows.map(serializeVectorRow);
    });

    ipcMain.handle('monitor:getTokenUsageRecords', async () => {
      return (store.monitor && store.monitor.getTokenUsageRecords) ? store.monitor.getTokenUsageRecords() : [];
    });

    ipcMain.handle('monitor:getFileModifications', async () => {
      return (store.monitor && store.monitor.getFileModifications) ? store.monitor.getFileModifications() : [];
    });

    ipcMain.handle('content:getIdentity', () => (store.identity ? store.identity.readIdentity() : { name: '', notes: '' }));
    ipcMain.handle('content:writeIdentity', (_, data) => { if (store.identity) store.identity.writeIdentity(data); });
    ipcMain.handle('content:getRequirements', (_, limit) => (store.requirements ? store.requirements.listRecent(limit === 0 ? 0 : (Number(limit) || 50)) : []));
    ipcMain.handle('content:writeRequirements', (_, list) => { if (store.requirements && store.requirements.replaceAll) store.requirements.replaceAll(list); return { ok: true }; });
    ipcMain.handle('content:writeRequirementsAsDocument', (_, doc) => {
      if (!store.requirements || !store.requirements.replaceAll) return { ok: false };
      const text = typeof doc === 'string' ? doc.trim() : '';
      if (text) store.requirements.replaceAll([{ text }]);
      return { ok: true };
    });
    ipcMain.handle('content:triggerRequirementsRefinement', async () => (store.requirements && store.requirements.triggerRefinementAsDocument ? await store.requirements.triggerRefinementAsDocument() : { success: false, message: '未加载' }));
    ipcMain.handle('content:triggerRefinementAsDocument', async (_, category) => {
      const RequirementsRefiner = require('../../packages/store/requirements_refiner.js');
      const refiner = new RequirementsRefiner();
      if (category === 'requirements' && store.requirements && store.requirements.triggerRefinementAsDocument) {
        return await store.requirements.triggerRefinementAsDocument();
      }
      if (category === 'corrections' && store.corrections) {
        const list = store.corrections.getRecentWithMeta ? store.corrections.getRecentWithMeta(0) : [];
        const texts = list.map((x) => x.text).filter(Boolean);
        if (!texts.length) return { success: false, message: '暂无纠错内容' };
        const doc = await refiner.refineToDocument(texts, 'corrections');
        if (store.corrections.replaceWithDocument) store.corrections.replaceWithDocument(doc);
        return { success: true, message: '纠错已总结为一份文档' };
      }
      if (category === 'preferences' && store.preferences) {
        const list = store.preferences.listAll ? store.preferences.listAll() : [];
        const schema = { topic_field: 'topic', summary_field: 'summary' };
        const lines = list.map((x) => `[${x[schema.topic_field] || x.topic || ''}] ${x[schema.summary_field] || x.summary || ''}`).filter(Boolean);
        if (!lines.length) return { success: false, message: '暂无喜好内容' };
        const doc = await refiner.refineToDocument(lines, 'preferences');
        if (store.preferences.replaceWithDocument) store.preferences.replaceWithDocument(doc);
        return { success: true, message: '喜好已总结为一份文档' };
      }
      return { success: false, message: '不支持的类别' };
    });
    ipcMain.handle('content:getState', () => (store.state ? store.state.readState() : null));
    ipcMain.handle('content:getProactiveState', () => (store.state ? store.state.readProactiveState() : null));
    ipcMain.handle('content:getEmotionsRecent', (_, limit) => (store.emotions ? store.emotions.getRecent(Number(limit) || 20) : []));
    ipcMain.handle('content:getExpressionDesiresRecent', (_, limit) => {
      const list = store.expressionDesires ? store.expressionDesires.getRecent(Number(limit) || 20) : [];
      const formatUtc = store.timeline && typeof store.timeline.formatTimestampForDisplay === 'function' ? store.timeline.formatTimestampForDisplay : () => '';
      return list.map((e) => ({ ...e, created_at_display_utc: formatUtc(e.created_at) || '' }));
    });
    ipcMain.handle('content:getCorrectionsRecent', (_, limit) => (store.corrections ? store.corrections.getRecent(Number(limit) || 20) : []));
    ipcMain.handle('content:getCorrectionsAll', () => (store.corrections && store.corrections.getRecentWithMeta ? store.corrections.getRecentWithMeta(0) : []));
    ipcMain.handle('content:writeCorrections', (_, list) => { if (store.corrections && store.corrections.replaceAll) store.corrections.replaceAll(list); return { ok: true }; });
    ipcMain.handle('content:writeCorrectionsAsDocument', (_, doc) => {
      if (!store.corrections || !store.corrections.replaceAll) return { ok: false };
      const text = typeof doc === 'string' ? doc.trim() : '';
      if (text) store.corrections.replaceAll([{ text }]);
      return { ok: true };
    });
    ipcMain.handle('content:getPreferences', () => (store.preferences && store.preferences.listAll ? store.preferences.listAll() : []));
    ipcMain.handle('content:writePreferences', (_, list) => { if (store.preferences && store.preferences.replaceAll) store.preferences.replaceAll(list); return { ok: true }; });
    ipcMain.handle('content:writePreferencesAsDocument', (_, doc) => { if (store.preferences && store.preferences.replaceWithDocument) store.preferences.replaceWithDocument(doc); return { ok: true }; });
    ipcMain.handle('content:getAvoidPhrases', () => {
      try {
        const { getAvoidPhrasesPath } = require('../../packages/config/paths.js');
        const fs = require('fs');
        const p = getAvoidPhrasesPath();
        if (!fs.existsSync(p)) return { avoid_phrases: [] };
        const raw = fs.readFileSync(p, 'utf8').trim();
        const data = raw ? JSON.parse(raw) : {};
        return { avoid_phrases: Array.isArray(data.avoid_phrases) ? data.avoid_phrases : [] };
      } catch (e) { return { avoid_phrases: [] }; }
    });
    ipcMain.handle('content:setAvoidPhrases', (_, phrases) => {
      try {
        const { getAvoidPhrasesPath } = require('../../packages/config/paths.js');
        const { getMemoryDir } = require('../../packages/config/paths.js');
        const fs = require('fs');
        const list = Array.isArray(phrases) ? phrases.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [];
        const dir = getMemoryDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(getAvoidPhrasesPath(), JSON.stringify({ avoid_phrases: list }, null, 2), 'utf8');
        return { ok: true };
      } catch (e) { return { ok: false, error: e?.message }; }
    });

    ipcMain.handle('config:get', () => ({ ...readConfig(), dataDir: getDataDir() }));
    ipcMain.handle('config:set', (_, data) => {
      writeConfig(data || {});
      try {
        const net = require('../../packages/server/dialogue/tools/network.js');
        if (net.clearNetworkConfigCache) net.clearNetworkConfigCache();
      } catch (_) {}
      return { ok: true };
    });

    ipcMain.handle('ollama:status', () => getOllamaStatus());
    ipcMain.handle('ollama:ensure', () => ensureOllamaStarted());
  }

  function runProactiveCheck() {
    if (dialogueBusy || !mainWindow || mainWindow.isDestroyed()) return;
    const idleMs = getProactiveIdleMs();
    if (Date.now() - lastDialogueAt < idleMs) return;
    if (proactivePromise) return;
    proactivePromise = new Promise((resolve) => { resolveProactive = resolve; });
    maybeProactiveMessage()
      .then((msg) => {
        if (msg && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('aris:proactive', msg);
        }
      })
      .catch((e) => console.warn('[Aris v2][electron] proactive check failed', e?.message))
      .finally(() => {
        if (resolveProactive) {
          resolveProactive();
          resolveProactive = null;
        }
        proactivePromise = null;
      });
  }

  function startProactiveInterval() {
    const intervalMs = getProactiveIntervalMs();
    if (intervalMs <= 0) {
      console.info('[Aris v2][electron] 定时器触发已禁用');
      return;
    }
    if (proactiveTimer) {
      clearInterval(proactiveTimer);
    }
    proactiveTimer = setInterval(runProactiveCheck, intervalMs);
    console.info(`[Aris v2][electron] 定时器触发已启动，间隔 ${intervalMs / 60000} 分钟`);
  }

  async function resumePendingRestartTasks() {
    try {
      const workState = require('../../packages/store/workState.js');
      const { getTools, runTool } = require('../../packages/server/dialogue/tools/index.js');
      const pending = workState.getPendingTasks ? workState.getPendingTasks() : [];
      if (!Array.isArray(pending) || pending.length === 0) return;

      const sessionId = await store.conversations.getCurrentSessionId();
      const toolNames = getTools().map((t) => t.function?.name).filter(Boolean);
      const context = { sessionId, toolNames };

      for (const p of pending) {
        const idx = typeof p.index === 'number' ? p.index : -1;
        const task = p?.task || {};
        const resumeTools = Array.isArray(task.resume_tools) ? task.resume_tools : [];
        const resumeMessage = typeof task.resume_message === 'string' ? task.resume_message : null;

        if (resumeTools.length === 0) {
          if (workState.completePendingTask && idx >= 0) workState.completePendingTask(idx);
          continue;
        }

        for (const rt of resumeTools) {
          const toolName = rt?.tool_name;
          const toolArgs = rt?.args || {};
          if (!toolName) continue;
          // 避免重启循环：续跑中如果还要重启，则交给下一次显式触发
          if (toolName === 'restart_application') continue;
          const res = await runTool(toolName, toolArgs, context);
          if (!res || res.ok === false) throw new Error(`resume tool failed: ${toolName}`);
        }

        const assistantText = resumeMessage || '重启后已继续执行未完成的任务。';
        try {
          await store.conversations.append(sessionId, 'assistant', assistantText);
        } catch (_) {}

        if (workState.completePendingTask && idx >= 0) workState.completePendingTask(idx);
      }

      if (workState.clearRestartState) workState.clearRestartState();
    } catch (e) {
      console.warn('[Aris v2][electron] resumePendingRestartTasks failed:', e?.message || e);
    }
  }

  createWindowFn = createWindow;
  createWindow();
  registerIpcHandlers();
  // 启动时先续办重启任务，再开始 proactive
  resumePendingRestartTasks().finally(() => startProactiveInterval());

  ensureOllamaStarted()
    .then((r) => {
      if (r.started) console.log('[Aris v2][electron] Ollama 已自动启动');
      else if (r.error === 'not_installed') { /* 未安装为正常，不打印 */ }
      else if (r.error) console.warn('[Aris v2][electron] Ollama 自动启动未就绪:', r.error);
    })
    .catch((e) => console.warn('[Aris v2][electron] Ollama 检测/启动异常', e?.message));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null && createWindowFn) createWindowFn();
});