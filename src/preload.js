'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a minimal, typed API to the renderer process.
 * All Ollama communication is proxied through the main process so the
 * renderer never has direct access to Node.js or the network.
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
   * @param {string}   requestId  Caller-generated unique ID for this request.
   * @param {string}   model      Ollama model name (e.g. "llama3").
   * @param {Array<{role:string, content:string}>} messages  Conversation history.
   */
  chat: (requestId, model, messages) =>
    ipcRenderer.send('ollama:chat', { requestId, model, messages }),

  /**
   * Register a listener for streaming response chunks.
   * The callback receives `{ requestId, content, done }`.
   * @param {function} callback
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
   * @param {function} callback
   * @returns {function} Unsubscribe function.
   */
  onChatError: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ollama:chat:error', handler);
    return () => ipcRenderer.removeListener('ollama:chat:error', handler);
  },
});
