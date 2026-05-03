'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const http = require('node:http');

// ---------------------------------------------------------------------------
// Ollama configuration (local-only; no external network required)
// ---------------------------------------------------------------------------
const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;

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

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Stream a chat request to Ollama.
 * Calls `onChunk(content)` for each token and `onDone()` when finished.
 * Returns a function that aborts the request when called.
 */
function ollamaChatStream(model, messages, onChunk, onDone, onError) {
  const payload = JSON.stringify({ model, messages, stream: true });
  const options = {
    hostname: OLLAMA_HOST,
    port: OLLAMA_PORT,
    path: '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const req = http.request(options, (res) => {
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
// IPC handlers
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
 */
ipcMain.on('ollama:chat', (event, { requestId, model, messages }) => {
  const send = (channel, data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, data);
    }
  };

  ollamaChatStream(
    model,
    messages,
    (content) => send('ollama:chat:chunk', { requestId, content, done: false }),
    () => send('ollama:chat:chunk', { requestId, content: '', done: true }),
    (err) => send('ollama:chat:error', { requestId, error: err.message }),
  );
});

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 400,
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
