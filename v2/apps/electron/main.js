require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const { handleUserMessage, getPromptPreview } = require('../../packages/server');
const { exportToFile, importFromFile } = require('./backup.js');
const store = require('../../packages/store');
const { RENDERER_INDEX, PRELOAD_SCRIPT } = require('./config.js');

let mainWindow = null;
let dialogueBusy = false;
let dialogueAbortController = null;

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

  const indexPath = path.join(__dirname, '..', 'renderer', 'dist', 'index.html');
  const fallback = path.join(__dirname, '..', 'renderer', 'index.html');
  if (require('fs').existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadFile(fallback);
  }

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
          label: '导出记忆数据库',
          click: async () => {
            const { filePath } = await dialog.showSaveDialog(mainWindow, {
              defaultPath: `aris-v2-backup-${new Date().toISOString().slice(0, 10)}.aris`,
              filters: [{ name: 'Aris 备份', extensions: ['aris'] }],
            });
            if (filePath) {
              try {
                const r = await exportToFile(filePath);
                dialog.showMessageBox(mainWindow, { type: 'info', title: '导出成功', message: `已导出到 ${filePath}${r.memoryCount != null ? `，向量 ${r.memoryCount} 条` : ''}` });
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
              properties: ['openFile'],
              filters: [{ name: 'Aris 备份', extensions: ['aris'] }],
            });
            if (filePaths && filePaths[0]) {
              try {
                await importFromFile(filePaths[0]);
                dialog.showMessageBox(mainWindow, { type: 'info', title: '导入成功', message: '记忆与对话已恢复。' });
              } catch (e) {
                dialog.showErrorBox('导入失败', e.message);
              }
            }
          },
        },
      ],
    },
  ];
  if (!isMac) {
    const fileMenu = template.find((m) => m.label === '文件');
    if (fileMenu && fileMenu.submenu) fileMenu.submenu.push({ type: 'separator' }, { label: '退出', role: 'quit' });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('dialogue:send', async (event, userContent) => {
  if (dialogueBusy) return { error: '请等待当前回复完成后再发送' };
  dialogueBusy = true;
  dialogueAbortController = new AbortController();
  const sendChunk = (chunk) => {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('dialogue:chunk', chunk);
  };
  const sendAgentActions = (actions) => {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('dialogue:agentActions', actions);
  };
  try {
    return await handleUserMessage(userContent, sendChunk, sendAgentActions, dialogueAbortController.signal);
  } finally {
    dialogueAbortController = null;
    dialogueBusy = false;
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

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
