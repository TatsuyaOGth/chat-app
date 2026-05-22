'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const http = require('node:http');

const storage = require('./storage');

// ---------------------------------------------------------------------------
// Ollama configuration (local-only; no external network required)
// ---------------------------------------------------------------------------
const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const OLLAMA_REQUEST_TIMEOUT_MS = 10_000;

/** Low-level helper: issue an HTTP request to the local Ollama server. */
function ollamaRequest(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.setTimeout(OLLAMA_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Ollama request timed out after ${OLLAMA_REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Build the Ollama /api/chat request body.
 *
 * - `system` is injected as the first message with role "system" (Ollama's
 *   /api/chat does not accept a top-level `system` field — only /api/generate
 *   does — so we prepend it to the messages array instead).
 * - Any keys in `options` whose value is `null` or `undefined` are dropped so
 *   Ollama falls back to its defaults for those parameters.
 */
function buildChatBody({ model, messages, system, options }) {
  const finalMessages = system && system.trim()
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const cleanedOptions = {};
  if (options && typeof options === 'object') {
    for (const [key, value] of Object.entries(options)) {
      if (value !== null && value !== undefined) cleanedOptions[key] = value;
    }
  }

  const body = { model, messages: finalMessages, stream: true };
  if (Object.keys(cleanedOptions).length > 0) body.options = cleanedOptions;
  return body;
}

/**
 * Stream a chat request to Ollama.
 * Calls `onChunk(content)` for each token and `onDone()` when finished.
 * Returns a function that aborts the request when called.
 */
function ollamaChatStream({ model, messages, system, options }, onChunk, onDone, onError) {
  const payload = JSON.stringify(buildChatBody({ model, messages, system, options }));
  const reqOptions = {
    hostname: OLLAMA_HOST,
    port: OLLAMA_PORT,
    path: '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = http.request(reqOptions, (res) => {
    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            onChunk(parsed.message.content);
          }
          if (parsed.done) {
            onDone();
          }
        } catch {
          // Ignore unparseable lines
        }
      }
    });

    res.on('end', () => {
      // Flush any remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.message?.content) onChunk(parsed.message.content);
          if (parsed.done) onDone();
        } catch {
          // Ignore
        }
      }
    });
  });

  req.on('error', onError);
  req.write(payload);
  req.end();

  return () => req.destroy();
}

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
    { model, messages, system, options },
    (content) => send('ollama:chat:chunk', { requestId, content, done: false }),
    () => send('ollama:chat:chunk', { requestId, content: '', done: true }),
    (err) => send('ollama:chat:error', { requestId, error: err.message }),
  );
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
// IPC handlers — Templates
// ---------------------------------------------------------------------------

ipcMain.handle('templates:list', () => storage.templates.list());
ipcMain.handle('templates:get', (_e, id) => storage.templates.get(id));
ipcMain.handle('templates:create', (_e, data) => storage.templates.create(data));
ipcMain.handle('templates:update', (_e, id, patch) => storage.templates.update(id, patch));
ipcMain.handle('templates:delete', (_e, id) => storage.templates.delete(id));
ipcMain.handle('templates:reorder', (_e, orderedIds) => storage.templates.reorder(orderedIds));

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
