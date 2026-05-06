'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a minimal, typed API to the renderer process.
 * All Ollama and storage access is proxied through the main process so the
 * renderer never has direct access to Node.js, the filesystem, or the network.
 */

contextBridge.exposeInMainWorld('ollama', {
  /**
   * Fetch the list of locally available models from Ollama.
   * @returns {Promise<{ models: string[], error?: string }>}
   */
  getModels: () => ipcRenderer.invoke('ollama:get-models'),

  /**
   * Send a chat request and receive the response as a stream.
   *
   * @param {string} requestId  Caller-generated unique ID for this request.
   * @param {object} payload
   * @param {string} payload.model     Ollama model name (e.g. "llama3").
   * @param {Array<{role:string, content:string}>} payload.messages  Conversation history.
   * @param {string} [payload.system]  Optional system prompt — prepended as a system message.
   * @param {object} [payload.options] Optional Ollama parameters (temperature, top_p, …).
   *                                   Keys with `null`/`undefined` values are dropped so
   *                                   Ollama uses its defaults.
   */
  chat: (requestId, { model, messages, system, options } = {}) =>
    ipcRenderer.send('ollama:chat', { requestId, model, messages, system, options }),

  /**
   * Register a listener for streaming response chunks.
   * The callback receives `{ requestId, content, done }`.
   * @returns {function} Unsubscribe function.
   */
  onChatChunk: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ollama:chat:chunk', handler);
    return () => ipcRenderer.removeListener('ollama:chat:chunk', handler);
  },

  /**
   * Register a listener for chat errors.
   * The callback receives `{ requestId, error }`.
   * @returns {function} Unsubscribe function.
   */
  onChatError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ollama:chat:error', handler);
    return () => ipcRenderer.removeListener('ollama:chat:error', handler);
  },
});

contextBridge.exposeInMainWorld('app', {
  /** Native confirm dialog (replaces window.confirm which is unreliable in Electron). */
  confirm: (message) => ipcRenderer.invoke('dialog:confirm', message),
});

contextBridge.exposeInMainWorld('templates', {
  list: () => ipcRenderer.invoke('templates:list'),
  get: (id) => ipcRenderer.invoke('templates:get', id),
  create: (data) => ipcRenderer.invoke('templates:create', data),
  update: (id, patch) => ipcRenderer.invoke('templates:update', id, patch),
  delete: (id) => ipcRenderer.invoke('templates:delete', id),
  reorder: (orderedIds) => ipcRenderer.invoke('templates:reorder', orderedIds),
});

contextBridge.exposeInMainWorld('sessions', {
  list: () => ipcRenderer.invoke('sessions:list'),
  get: (id) => ipcRenderer.invoke('sessions:get', id),
  create: (data) => ipcRenderer.invoke('sessions:create', data),
  update: (id, patch) => ipcRenderer.invoke('sessions:update', id, patch),
  appendMessage: (id, message) => ipcRenderer.invoke('sessions:append-message', id, message),
  delete: (id) => ipcRenderer.invoke('sessions:delete', id),
});
