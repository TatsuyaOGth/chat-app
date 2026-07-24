'use strict';

const http = require('node:http');
const https = require('node:https');

const OLLAMA_HOST = 'localhost';
const OLLAMA_PORT = 11434;
const OLLAMA_REQUEST_TIMEOUT_MS = 10_000;
const INACTIVITY_TIMEOUT_MS = 30_000;

/**
 * Resolve a base URL (e.g. "http://192.168.1.50:11434") into the pieces
 * needed to issue a Node `http`/`https` request. Falls back to the local
 * default when `baseUrl` is not provided, so existing callers that don't
 * pass one keep talking to localhost:11434.
 */
function resolveOllamaConnection(baseUrl) {
  const url = new URL(baseUrl || `http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`サポートされていないプロトコルです: ${url.protocol}`);
  }
  return {
    httpModule: url.protocol === 'https:' ? https : http,
    hostname: url.hostname,
    port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
    pathPrefix: url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''),
  };
}

function buildChatBody({ model, messages, system, options, think }) {
  const finalMessages = system && system.trim()
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const cleanedOptions = {};
  if (options && typeof options === 'object') {
    for (const [key, value] of Object.entries(options)) {
      if (value !== null && value !== undefined) cleanedOptions[key] = value;
    }
  }

  const body = { model, messages: finalMessages, stream: true, think: think !== false };
  if (Object.keys(cleanedOptions).length > 0) body.options = cleanedOptions;
  return body;
}

function ollamaRequest(method, pathname, body, deps = {}) {
  const conn = resolveOllamaConnection(deps.baseUrl);
  const httpModule = deps.httpModule || conn.httpModule;
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
      hostname: conn.hostname,
      port: conn.port,
      path: conn.pathPrefix + pathname,
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

function ollamaChatStream(payload, onChunk, onDone, onError, deps = {}, onThinking = null) {
  const conn = resolveOllamaConnection(deps.baseUrl);
  const httpModule = deps.httpModule || conn.httpModule;
  const activeRequests = deps.activeRequests || new Map();
  const inactivityTimeoutMs = deps.inactivityTimeoutMs ?? INACTIVITY_TIMEOUT_MS;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;

  const requestBody = JSON.stringify(buildChatBody(payload));
  const reqOptions = {
    hostname: conn.hostname,
    port: conn.port,
    path: conn.pathPrefix + '/api/chat',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(requestBody),
    },
  };

  const { requestId } = payload;
  let finished = false;
  let inactivityTimer = null;

  // ── <think> tag stream parser ──────────────────────────────────────────────
  // Tracks whether we are inside a <think>...</think> block.  We need to
  // buffer partial tag boundaries so that a tag split across two HTTP chunks
  // (e.g. "<thi" + "nk>") is handled correctly.
  //
  // This parser is only used as a fallback when the Ollama server does NOT
  // emit a native `message.thinking` field (i.e. when `think: true` is not
  // supported by the running Ollama version or model).
  let nativeThinkingSeen = false; // set to true once message.thinking arrives
  let thinkState = 'normal';      // 'normal' | 'in_think'
  let thinkBuf = '';              // pending text that might be part of a tag

  const OPEN_TAG = '<think>';
  const CLOSE_TAG = '</think>';

  /**
   * Feed `text` (a raw content chunk) through the <think> tag state machine.
   * Emits onThinking() for thinking text and onChunk() for visible text.
   */
  function processContentWithTags(text) {
    if (nativeThinkingSeen || typeof onThinking !== 'function') {
      onChunk(text);
      return;
    }

    thinkBuf += text;

    let out = '';
    while (thinkBuf.length > 0) {
      if (thinkState === 'normal') {
        const openIdx = thinkBuf.indexOf(OPEN_TAG);
        if (openIdx === -1) {
          // No open tag — check whether the tail could be the start of <think>
          const safeLen = Math.max(0, thinkBuf.length - (OPEN_TAG.length - 1));
          out += thinkBuf.slice(0, safeLen);
          thinkBuf = thinkBuf.slice(safeLen);
          break;
        }
        // Emit everything before the tag as normal content
        out += thinkBuf.slice(0, openIdx);
        thinkBuf = thinkBuf.slice(openIdx + OPEN_TAG.length);
        thinkState = 'in_think';
      } else {
        // in_think
        const closeIdx = thinkBuf.indexOf(CLOSE_TAG);
        if (closeIdx === -1) {
          // Keep a tail buffer in case </think> straddles a chunk boundary
          const safeLen = Math.max(0, thinkBuf.length - (CLOSE_TAG.length - 1));
          if (safeLen > 0 && typeof onThinking === 'function') {
            onThinking(thinkBuf.slice(0, safeLen));
          }
          thinkBuf = thinkBuf.slice(safeLen);
          break;
        }
        if (typeof onThinking === 'function') {
          onThinking(thinkBuf.slice(0, closeIdx));
        }
        thinkBuf = thinkBuf.slice(closeIdx + CLOSE_TAG.length);
        thinkState = 'normal';
      }
    }

    if (out) onChunk(out);
  }

  /**
   * Flush any remaining buffered text when the stream ends.
   * At stream end there won't be more chunks, so any partial-tag buffer is
   * safe to emit as-is.
   */
  function flushThinkBuf() {
    if (!thinkBuf) return;
    if (thinkState === 'in_think') {
      if (typeof onThinking === 'function') onThinking(thinkBuf);
    } else {
      onChunk(thinkBuf);
    }
    thinkBuf = '';
  }
  // ──────────────────────────────────────────────────────────────────────────

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

          // Native thinking field (Ollama >= 0.7.0 + think: true)
          if (parsed.message?.thinking && typeof onThinking === 'function') {
            nativeThinkingSeen = true;
            onThinking(parsed.message.thinking);
          }

          if (parsed.message?.content) {
            processContentWithTags(parsed.message.content);
          }

          if (parsed.done && !finished) {
            finished = true;
            cleanup();
            flushThinkBuf();
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
          if (parsed.message?.thinking && typeof onThinking === 'function' && !finished) {
            nativeThinkingSeen = true;
            onThinking(parsed.message.thinking);
          }
          if (parsed.message?.content && !finished) processContentWithTags(parsed.message.content);
          if (parsed.done && !finished) {
            finished = true;
            cleanup();
            flushThinkBuf();
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
        flushThinkBuf();
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
  resolveOllamaConnection,
  buildChatBody,
  ollamaRequest,
  ollamaChatStream,
};