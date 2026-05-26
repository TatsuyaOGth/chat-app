'use strict';

const http = require('node:http');

const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const OLLAMA_REQUEST_TIMEOUT_MS = 10_000;
const INACTIVITY_TIMEOUT_MS = 30_000;

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

function ollamaRequest(method, pathname, body, deps = {}) {
  const httpModule = deps.httpModule || http;
  const requestTimeoutMs = deps.requestTimeoutMs ?? OLLAMA_REQUEST_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

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

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolveOnce(JSON.parse(data));
        } catch {
          resolveOnce(data);
        }
      });
    });

    req.setTimeout(requestTimeoutMs, () => {
      req.destroy();
      rejectOnce(new Error(`Ollama request timed out after ${requestTimeoutMs}ms`));
    });
    req.on('error', rejectOnce);
    if (payload) req.write(payload);
    req.end();
  });
}

function ollamaChatStream(payload, onChunk, onDone, onError, deps = {}) {
  const httpModule = deps.httpModule || http;
  const activeRequests = deps.activeRequests || new Map();
  const inactivityTimeoutMs = deps.inactivityTimeoutMs ?? INACTIVITY_TIMEOUT_MS;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;

  const requestBody = JSON.stringify(buildChatBody(payload));
  const reqOptions = {
    hostname: OLLAMA_HOST,
    port: OLLAMA_PORT,
    path: '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
    },
  };

  const { requestId } = payload;
  let finished = false;
  let inactivityTimer = null;

  function cleanup() {
    clearTimeoutFn(inactivityTimer);
    activeRequests.delete(requestId);
  }

  function resetInactivityTimer() {
    clearTimeoutFn(inactivityTimer);
    inactivityTimer = setTimeoutFn(() => {
      if (!finished) {
        finished = true;
        cleanup();
        req.destroy();
        onError(new Error('応答タイムアウト: サーバーからの応答が途絶えました'));
      }
    }, inactivityTimeoutMs);
  }

  const req = httpModule.request(reqOptions, (res) => {
    if (res.statusCode !== 200) {
      let errBody = '';
      res.on('data', (chunk) => { errBody += chunk.toString('utf8'); });
      res.on('end', () => {
        if (finished) return;
        finished = true;
        cleanup();
        let detail;
        try {
          const parsed = JSON.parse(errBody);
          detail = parsed.error || parsed.message || errBody;
        } catch {
          detail = errBody || `HTTP ${res.statusCode}`;
        }
        onError(new Error(`HTTP ${res.statusCode}: ${detail}`));
      });
      return;
    }

    resetInactivityTimer();
    let buffer = '';
    let parseFailCount = 0;

    res.on('data', (chunk) => {
      resetInactivityTimer();
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) onChunk(parsed.message.content);
          if (parsed.done && !finished) {
            finished = true;
            cleanup();
            onDone();
          }
        } catch {
          parseFailCount++;
          if (parseFailCount <= 3 || parseFailCount % 20 === 0) {
            console.warn(`[ollama:${requestId}] JSON parse failed (×${parseFailCount}):`, line.slice(0, 200));
          }
        }
      }
    });

    res.on('end', () => {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.message?.content && !finished) onChunk(parsed.message.content);
          if (parsed.done && !finished) {
            finished = true;
            cleanup();
            onDone();
            return;
          }
        } catch {
          console.warn(`[ollama:${requestId}] JSON parse failed on final buffer:`, buffer.slice(0, 200));
        }
      }

      if (!finished) {
        finished = true;
        cleanup();
        onDone();
      }
    });
  });

  req.on('error', (err) => {
    if (!finished) {
      finished = true;
      cleanup();
      onError(err);
    }
  });

  req.write(requestBody);
  req.end();

  activeRequests.set(requestId, () => {
    if (!finished) {
      finished = true;
      cleanup();
      req.destroy();
      return true;
    }
    return false;
  });
}

module.exports = {
  OLLAMA_HOST,
  OLLAMA_PORT,
  OLLAMA_REQUEST_TIMEOUT_MS,
  INACTIVITY_TIMEOUT_MS,
  buildChatBody,
  ollamaRequest,
  ollamaChatStream,
};