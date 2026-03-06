require('dotenv').config();
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const { handleUserMessage } = require('./src/dialogue/handler.js');
const { getActiveWindowTitle } = require('./src/context/windowTitle.js');
const { exportToFile, importFromFile } = require('./src/store/backup.js');
const { getAllSessions, getAllForSession, clearAllConversations } = require('./src/store/conversations.js');
let mainWindow = null;
let historyWindow = null;
let memoryWindow = null;

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 420,
    height: 420,
    transparent: true,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 12, y: 18 } : undefined,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Receive clicks so user can click center to open dialogue (setIgnoreMouseEvents(false))
  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupAppMenu();
  startProactiveInterval();
}

function setupAppMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '导出记忆数据库',
          click: async () => {
            const { filePath } = await dialog.showSaveDialog(mainWindow, {
              title: '导出记忆',
              defaultPath: `aris-backup-${new Date().toISOString().slice(0, 10)}.aris`,
              filters: [{ name: 'Aris 备份', extensions: ['aris'] }],
            });
            if (filePath) {
              try {
                const { memoryCount } = await exportToFile(filePath);
                dialog.showMessageBox(mainWindow, { type: 'info', title: '导出成功', message: `已导出到 ${filePath}${memoryCount != null ? `，向量记忆 ${memoryCount} 条` : ''}` });
              } catch (e) {
                dialog.showErrorBox('导出失败', e.message);
              }
            }
          },
        },
        {
          label: '导入记忆数据库',
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog(mainWindow, {
              title: '选择备份文件',
              properties: ['openFile'],
              filters: [{ name: 'Aris 备份', extensions: ['aris'] }],
            });
            if (filePaths && filePaths[0]) {
              try {
                await importFromFile(filePaths[0]);
                dialog.showMessageBox(mainWindow, { type: 'info', title: '导入成功', message: '记忆与对话已恢复。若有对话未刷新，可重启应用。' });
              } catch (e) {
                dialog.showErrorBox('导入失败', e.message);
              }
            }
          },
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '查看历史记录',
          click: () => openHistoryWindow(),
        },
        {
          label: '记忆管理器',
          click: () => openMemoryWindow(),
        },
      ],
    },
    ...(!isMac ? [{
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' },
      ],
    }] : []),
  ];
  if (!isMac) {
    const fileMenu = template.find((m) => m.label === '文件');
    if (fileMenu && Array.isArray(fileMenu.submenu)) {
      fileMenu.submenu.push({ type: 'separator' }, { label: '退出', role: 'quit' });
    }
  }
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function openHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }
  historyWindow = new BrowserWindow({
    width: 520,
    height: 560,
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.history.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  historyWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'history.html'));
  historyWindow.on('closed', () => { historyWindow = null; });
}

function openMemoryWindow() {
  if (memoryWindow && !memoryWindow.isDestroyed()) {
    memoryWindow.focus();
    return;
  }
  memoryWindow = new BrowserWindow({
    width: 980,
    height: 720,
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.memory.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  memoryWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'memory.html'));
  memoryWindow.on('closed', () => { memoryWindow = null; });
}

function startProactiveInterval() {
  const { maybeProactiveMessage } = require('./src/dialogue/proactive.js');
  setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const msg = await maybeProactiveMessage();
    if (msg) mainWindow.webContents.send('aris:proactive', msg);
  }, 3 * 60 * 1000);
}

async function checkOllamaEmbed() {
  const host = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace('localhost', '127.0.0.1');
  const model = process.env.ARIS_EMBED_MODEL || 'nomic-embed-text';
  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hasModel = data.models?.some((m) => (m.name || '').startsWith(model));
    if (!hasModel) {
      console.warn(`[Aris] 记忆系统需要 Ollama 模型 "${model}"，请执行: ollama pull ${model}`);
    }
  } catch (e) {
    const msg = e.message || '';
    const isConnection = /fetch failed|ECONNREFUSED|connect/i.test(msg);
    if (isConnection) {
      console.warn(
        '[Aris] 记忆系统需要 Ollama 服务在运行。请先启动：' +
        '在菜单栏打开 Ollama 应用，或在终端执行 ollama serve 并保持窗口打开。'
      );
    } else {
      console.warn(`[Aris] 记忆系统需要 Ollama。请启动 Ollama 并拉取模型: ollama pull ${model}`);
    }
  }
}

app.whenReady().then(() => {
  createWindow();
  checkOllamaEmbed();
  try {
    const { getStats } = require('./src/memory/lancedb.js');
    getStats().then((s) => {
      console.info(`[Aris][memory] LanceDB path=${s.path} total(sampled)=${s.total}`);
    }).catch(() => {});
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

ipcMain.on('set-ignore-mouse-events', (_, ignore, options) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
  }
});

ipcMain.handle('get-window-title', () => getActiveWindowTitle());

ipcMain.handle('dialogue:send', async (event, userContent) => {
  const sendChunk = (chunk) => event.sender.send('dialogue:chunk', chunk);
  const result = await handleUserMessage(userContent, sendChunk);
  return result;
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle('history:getSessions', async () => {
  return getAllSessions();
});

ipcMain.handle('history:getConversation', async (_, sessionId) => {
  return getAllForSession(sessionId);
});

ipcMain.handle('history:clearAll', async () => {
  await clearAllConversations();
});

ipcMain.handle('memory:clearAll', async () => {
  const { resetLanceDb } = require('./src/memory/lancedb.js');
  await resetLanceDb();
});

ipcMain.handle('memory:getStats', async () => {
  const { getStats } = require('./src/memory/lancedb.js');
  return getStats();
});

ipcMain.handle('memory:list', async (_, params) => {
  const { listAllMeta } = require('./src/memory/lancedb.js');
  const limit = params && typeof params.limit === 'number' ? params.limit : 3000;
  return listAllMeta(Math.max(1, Math.min(20000, limit)));
});

ipcMain.handle('memory:semanticSearch', async (_, { query, limit }) => {
  const { embed } = require('./src/memory/embedding.js');
  const { search } = require('./src/memory/lancedb.js');
  const q = String(query || '').trim();
  if (!q) return [];
  const k = Math.max(1, Math.min(50, Number(limit || 8) || 8));
  const vec = await embed(q);
  if (!vec) return [];
  const rows = await search(vec, k);
  return (rows || []).map((r) => ({
    id: r.id,
    text: r.text,
    type: r.type,
    created_at: r.created_at,
    _distance: r._distance,
    _score: r._score,
  })).filter((r) => r.text != null && String(r.text).trim() !== '');
});

ipcMain.handle('memory:reindexFromHistory', async () => {
  const { getDb } = require('./src/store/db.js');
  const { embed } = require('./src/memory/embedding.js');
  const { addMemory, resetLanceDb, getLanceDbPath } = require('./src/memory/lancedb.js');

  console.info('[Aris][memory] reindexFromHistory: start');
  await resetLanceDb();
  console.info(`[Aris][memory] reindexFromHistory: cleared LanceDB at ${getLanceDbPath()}`);

  const db = await getDb();
  const stmt = db.prepare('SELECT role, content, created_at FROM conversations ORDER BY created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(stmt.get());
  stmt.free();

  console.info(`[Aris][memory] reindexFromHistory: loaded ${rows.length} conversation rows (by dialogue turn: pair or single)`);
  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; ) {
    const [role, content] = rows[i];
    const textRaw = String(content || '').trim();
    const next = rows[i + 1];
    const nextRole = next ? next[0] : null;
    const nextContent = next ? String(next[1] || '').trim() : '';

    if (!textRaw && !nextContent) {
      i += next ? 2 : 1;
      skipped++;
      continue;
    }

    let text;
    let type;
    let advance = 1;

    if (role === 'user' && nextRole === 'assistant' && textRaw && nextContent) {
      text = `用户: ${textRaw.slice(0, 300)}\nAris: ${nextContent.slice(0, 500)}`;
      type = 'dialogue_turn';
      advance = 2;
    } else {
      if (!textRaw) {
        i += 1;
        skipped++;
        continue;
      }
      const who = role === 'user' ? '用户' : 'Aris';
      text = `${who}: ${textRaw.slice(0, 800)}`;
      type = role === 'user' ? 'user_view' : 'aris_thought';
    }

    try {
      const vec = await embed(text);
      if (!vec || !Array.isArray(vec) || vec.length === 0) {
        failed++;
      } else {
        await addMemory({ text, vector: vec, type });
        ok++;
      }
    } catch (_) {
      failed++;
    }
    i += advance;
    if ((ok + failed) % 30 === 0 || i >= rows.length) {
      console.info(`[Aris][memory] reindexFromHistory: progress rows ${i}/${rows.length} ok=${ok} failed=${failed} skipped=${skipped}`);
    }
  }

  console.info(`[Aris][memory] reindexFromHistory: done ok=${ok} failed=${failed} skipped=${skipped}`);
  return { ok, failed, skipped, total: rows.length };
});
