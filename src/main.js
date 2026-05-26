'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');

const storage = require('./storage');
const { ollamaRequest, ollamaChatStream } = require('./ollama');

// ---------------------------------------------------------------------------
// Ollama configuration (local-only; no external network required)
// ---------------------------------------------------------------------------
/** Map<requestId, abortFn> — lets the cancel IPC handler kill a live request. */
const activeRequests = new Map();

// ---------------------------------------------------------------------------
// IPC handlers — Ollama
// ---------------------------------------------------------------------------

/** Returns a list of locally available Ollama models. */
ipcMain.handle('ollama:get-models', async () => {
  try {
    const result = await ollamaRequest('GET', '/api/tags', null);
    return { models: (result.models || []).map((m) => m.name) };
  } catch (err) {
    return { models: [], error: err.message };
  }
});

/**
 * Check whether a given model is currently loaded in Ollama's process list.
 * Returns { loaded: boolean }.
 */
ipcMain.handle('ollama:check-loaded', async (_event, model) => {
  try {
    const result = await ollamaRequest('GET', '/api/ps', null);
    const running = result.models || [];
    const loaded = running.some((m) => m.name === model || m.model === model);
    return { loaded };
  } catch {
    return { loaded: false };
  }
});

/**
 * Streaming chat: fires `ollama:chat:chunk` events back to the renderer
 * until the response is complete or an error occurs.
 *
 * Payload: { requestId, model, messages, system?, options? }
 */
ipcMain.on('ollama:chat', (event, payload) => {
  const send = (channel, data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, data);
    }
  };

  const { requestId, model, messages, system, options } = payload;

  ollamaChatStream(
    { requestId, model, messages, system, options },
    (content) => send('ollama:chat:chunk', { requestId, content, done: false }),
    () => send('ollama:chat:chunk', { requestId, content: '', done: true }),
    (err) => send('ollama:chat:error', { requestId, error: err.message || err.code || '不明なエラー' }),
    { activeRequests },
  );
});

ipcMain.on('ollama:chat:cancel', (event, { requestId }) => {
  const abort = activeRequests.get(requestId);
  if (abort && abort()) {
    if (!event.sender.isDestroyed()) {
      event.sender.send('ollama:chat:error', { requestId, error: 'キャンセルされました', cancelled: true });
    }
  }
});

// ---------------------------------------------------------------------------
// IPC handlers — Native dialogs
// ---------------------------------------------------------------------------

// `window.prompt()` always returns null in Electron; `window.confirm()` is
// unreliable in some versions. We replace both with IPC calls.

ipcMain.handle('dialog:confirm', async (event, message) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['キャンセル', 'OK'],
    defaultId: 1,
    cancelId: 0,
    message,
  });
  return response === 1;
});

// ---------------------------------------------------------------------------
// IPC handlers — Presets
// ---------------------------------------------------------------------------

ipcMain.handle('presets:list', () => storage.presets.list());
ipcMain.handle('presets:get', (_e, id) => storage.presets.get(id));
ipcMain.handle('presets:create', (_e, data) => storage.presets.create(data));
ipcMain.handle('presets:update', (_e, id, patch) => storage.presets.update(id, patch));
ipcMain.handle('presets:delete', (_e, id) => storage.presets.delete(id));
ipcMain.handle('presets:reorder', (_e, orderedIds) => storage.presets.reorder(orderedIds));

// ---------------------------------------------------------------------------
// IPC handlers — Sessions
// ---------------------------------------------------------------------------

ipcMain.handle('sessions:list', () => storage.sessions.list());
ipcMain.handle('sessions:get', (_e, id) => storage.sessions.get(id));
ipcMain.handle('sessions:create', (_e, data) => storage.sessions.create(data));
ipcMain.handle('sessions:update', (_e, id, patch) => storage.sessions.update(id, patch));
ipcMain.handle('sessions:append-message', (_e, id, message) => storage.sessions.appendMessage(id, message));
ipcMain.handle('sessions:delete', (_e, id) => storage.sessions.delete(id));

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'Chat App',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
