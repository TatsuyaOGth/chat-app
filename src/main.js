'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const storage = require('./storage');
const { ollamaRequest, ollamaChatStream } = require('./ollama');

// ---------------------------------------------------------------------------
// Ollama configuration (local-only; no external network required)
// ---------------------------------------------------------------------------
/** Map<requestId, abortFn> — lets the cancel IPC handler kill a live request. */
const activeRequests = new Map();

const TAVILY_API_URL = 'https://api.tavily.com/search';
const TAVILY_TIMEOUT_MS = 12_000;
const TAVILY_CONFIG_FILENAME = 'tavily-config.json';
const OLLAMA_SUMMARY_TIMEOUT_MS = 300_000;
const OLLAMA_TEST_CONNECTION_TIMEOUT_MS = 5_000;

function isValidOllamaBaseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getTavilyConfigPath() {
  return path.join(app.getPath('userData'), TAVILY_CONFIG_FILENAME);
}

function readTavilyApiKeyFromLocalConfig() {
  try {
    const configPath = getTavilyConfigPath();
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const key = parsed?.apiKey;
    if (typeof key !== 'string') return null;
    const trimmed = key.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function writeTavilyApiKeyToLocalConfig(apiKey) {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) {
    throw new Error('API Key を入力してください');
  }

  const configPath = getTavilyConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    apiKey: trimmed,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  return configPath;
}

function deleteTavilyApiKeyLocalConfig() {
  const configPath = getTavilyConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
    return { deleted: true, path: configPath };
  }
  return { deleted: false, path: configPath };
}

function getTavilyConfigStatus() {
  const envKey = process.env.TAVILY_API_KEY;
  if (typeof envKey === 'string' && envKey.trim()) {
    return { configured: true, source: 'env' };
  }
  const localKey = readTavilyApiKeyFromLocalConfig();
  if (localKey) {
    return { configured: true, source: 'file' };
  }
  return { configured: false, source: 'none' };
}

function getTavilyApiKey() {
  const envKey = process.env.TAVILY_API_KEY;
  if (typeof envKey === 'string' && envKey.trim()) {
    return envKey.trim();
  }
  return readTavilyApiKeyFromLocalConfig();
}

function isLikelyInvalidTavilyKeyError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  const patterns = [
    'http 401',
    'http 403',
    'unauthorized',
    'forbidden',
    'invalid api key',
    'invalid_api_key',
    'api key is invalid',
    'api_key is invalid',
    'missing api key',
    'missing api_key',
    'api key missing',
    'api_key missing',
    'api key provided is invalid',
  ];
  if (patterns.some((p) => msg.includes(p))) return true;
  return msg.includes('api key') && msg.includes('invalid');
}

function isSummaryTimeoutError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('timed out') || msg.includes('timeout');
}

function getLatestUserMessage(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return '';
}

function shortenText(text, maxLen = 360) {
  if (typeof text !== 'string') return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}…`;
}

function deriveSearchOptionsFromQuery(query) {
  const raw = String(query || '').replace(/[「」"']/g, ' ').trim();
  const cleaned = raw
    .replace(/要約してください|要約して|まとめてください|まとめて|教えてください|教えて/g, ' ')
    .replace(/[。．！？!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const searchQuery = cleaned || raw;

  const hasNewsIntent = /(ニュース|news)/i.test(searchQuery);
  const hasRecencyIntent = /(先週|last week|今週|今日|最新|最近|直近|current|latest)/i.test(searchQuery);
  const topic = hasNewsIntent || hasRecencyIntent ? 'news' : 'general';

  let days;
  if (/(先週|last week|直近1週間|過去7日|7日間)/i.test(searchQuery)) {
    days = 7;
  } else if (/(今月|先月|直近1か月|直近1ヶ月|過去30日|30日間|latest)/i.test(searchQuery)) {
    days = 30;
  }

  return {
    searchQuery,
    topic,
    days,
    recencyDays: days,
  };
}

function createTavilySearchRequest(apiKey, query, {
  maxResults = 5,
  timeoutMs = TAVILY_TIMEOUT_MS,
  topic = 'general',
  days,
} = {}) {
  let req;
  const promise = new Promise((resolve, reject) => {
    const body = {
      api_key: apiKey,
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: 'advanced',
      topic,
    };
    if (typeof days === 'number' && Number.isFinite(days) && days > 0) {
      body.days = days;
    }
    const payload = JSON.stringify(body);

    const url = new URL(TAVILY_API_URL);
    req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let detail = data;
          try {
            const parsed = JSON.parse(data);
            detail = parsed.error || parsed.message || data;
          } catch {
            // keep raw body detail
          }
          reject(new Error(`Tavily HTTP ${res.statusCode}: ${detail || '検索に失敗しました'}`));
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Tavily の応答JSONを解析できませんでした'));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Tavily request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  return {
    promise,
    abort: () => {
      if (req) req.destroy();
    },
  };
}

function normalizeTavilyResults(raw, { recencyDays } = {}) {
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const mapped = results
    .map((item) => {
      const publishedAt = typeof item?.published_date === 'string' ? item.published_date : null;
      const publishedAtTs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
      return {
        title: shortenText(typeof item?.title === 'string' ? item.title : '', 140),
        url: typeof item?.url === 'string' ? item.url.trim() : '',
        snippet: shortenText(typeof item?.content === 'string' ? item.content : '', 360),
        publishedAt,
        publishedAtTs,
      };
    })
    .filter((item) => item.title || item.url || item.snippet);

  let ranked = mapped;
  if (typeof recencyDays === 'number' && Number.isFinite(recencyDays) && recencyDays > 0) {
    const cutoff = Date.now() - (recencyDays * 24 * 60 * 60 * 1000);
    const recent = mapped.filter((item) => Number.isFinite(item.publishedAtTs) && item.publishedAtTs >= cutoff);
    const undated = mapped.filter((item) => !Number.isFinite(item.publishedAtTs));
    if (recent.length > 0) {
      ranked = [...recent, ...undated];
    }
  }

  return {
    answer: shortenText(typeof raw?.answer === 'string' ? raw.answer : '', 400),
    results: ranked
      .slice(0, 5),
  };
}

async function summarizeSearchResultsWithModel(model, query, searchData, baseUrl) {
  const lines = searchData.results.map((r, idx) => (
    `${idx + 1}. ${r.title}\nURL: ${r.url}\n要約: ${r.snippet}`
  ));

  const userPrompt = [
    `ユーザー質問: ${query}`,
    searchData.answer ? `Tavily answer:\n${searchData.answer}` : '',
    '検索結果:',
    lines.join('\n\n'),
    '',
    '要件:',
    '- 日本語で簡潔に要約する',
    '- 事実のみを述べる',
    '- 末尾に「出典」を付け、対応するURL番号を示す',
  ].filter(Boolean).join('\n');

  const response = await ollamaRequest('POST', '/api/chat', {
    model,
    stream: false,
    messages: [
      {
        role: 'system',
        content: 'あなたは検索結果の要約アシスタントです。憶測せず、与えられた情報のみで回答してください。',
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    options: {
      temperature: 0.2,
      num_predict: 220,
    },
  }, {
    baseUrl,
    requestTimeoutMs: OLLAMA_SUMMARY_TIMEOUT_MS,
  });

  const summary = response?.message?.content;
  return typeof summary === 'string' ? summary.trim() : '';
}

function buildFallbackSummaryFromSearchData(query, searchData) {
  const lines = [];
  if (searchData.answer) {
    lines.push(`- Tavily回答: ${searchData.answer}`);
  }

  searchData.results.slice(0, 3).forEach((r, idx) => {
    const title = r.title || `結果${idx + 1}`;
    const snippet = r.snippet || '(要約なし)';
    lines.push(`- ${title}: ${snippet}`);
  });

  if (lines.length === 0) {
    return `「${query}」に関する検索結果は取得できましたが、要約できませんでした。出典を参照して回答してください。`;
  }

  return [
    `「${query}」に関する検索結果サマリー:`,
    ...lines,
  ].join('\n');
}

function mergeSystemWithSearchSummary(system, summary, searchData) {
  const sourceLines = searchData.results
    .map((r, idx) => `${idx + 1}. ${r.title || '(no title)'} - ${r.url || '(no url)'}`)
    .join('\n');

  const searchBlock = [
    '以下は外部Web検索の要約です。回答時の参考情報として扱い、断定できない場合は不確実性を明示してください。',
    '',
    '[検索要約]',
    summary,
    '',
    '[出典]',
    sourceLines,
  ].join('\n');

  if (typeof system === 'string' && system.trim()) {
    return `${system.trim()}\n\n${searchBlock}`;
  }
  return searchBlock;
}

// ---------------------------------------------------------------------------
// IPC handlers — Ollama
// ---------------------------------------------------------------------------

/** Returns a list of locally available Ollama models. */
ipcMain.handle('ollama:get-models', async () => {
  try {
    const { baseUrl } = storage.ollamaConfig.get();
    const result = await ollamaRequest('GET', '/api/tags', null, { baseUrl });
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
    const { baseUrl } = storage.ollamaConfig.get();
    const result = await ollamaRequest('GET', '/api/ps', null, { baseUrl });
    const running = result.models || [];
    const loaded = running.some((m) => m.name === model || m.model === model);
    return { loaded };
  } catch {
    return { loaded: false };
  }
});

/** Returns the currently configured Ollama connection ({ baseUrl }). */
ipcMain.handle('ollama:get-config', () => storage.ollamaConfig.get());

/**
 * Save the Ollama base URL. Validates the URL format only — persisting
 * succeeds independently of whether the server is actually reachable, so
 * users can configure a remote machine before it's running.
 */
ipcMain.handle('ollama:set-config', (_event, baseUrl) => {
  const trimmed = String(baseUrl || '').trim();
  if (!isValidOllamaBaseUrl(trimmed)) {
    return { ok: false, error: 'http:// または https:// で始まる正しいURLを入力してください' };
  }
  const saved = storage.ollamaConfig.set(trimmed);
  return { ok: true, baseUrl: saved.baseUrl };
});

/**
 * Test connectivity to an Ollama server via GET /api/tags.
 * Uses the given baseUrl, or falls back to the saved config when omitted.
 */
ipcMain.handle('ollama:test-connection', async (_event, baseUrl) => {
  const target = baseUrl ? String(baseUrl).trim() : storage.ollamaConfig.get().baseUrl;
  if (!isValidOllamaBaseUrl(target)) {
    return { ok: false, error: '不正なURLです' };
  }
  try {
    const result = await ollamaRequest('GET', '/api/tags', null, {
      baseUrl: target,
      requestTimeoutMs: OLLAMA_TEST_CONNECTION_TIMEOUT_MS,
    });
    return { ok: true, modelCount: (result.models || []).length };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

/**
 * Streaming chat: fires `ollama:chat:chunk` events back to the renderer
 * until the response is complete or an error occurs.
 *
 * Payload: { requestId, model, messages, system?, options?, webSearchEnabled? }
 */
ipcMain.on('ollama:chat', (event, payload) => {
  const send = (channel, data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(channel, data);
    }
  };

  const {
    requestId,
    model,
    messages,
    system,
    options,
    webSearchEnabled = false,
    reasoningEnabled,
  } = payload;

  let cancelled = false;
  let stageAbort = null;
  let searchInfoSent = false;

  const emitSearchInfo = (query, summary, results) => {
    if (searchInfoSent) return;
    searchInfoSent = true;
    send('ollama:chat:search-info', {
      requestId,
      query,
      summary,
      results,
    });
  };

  activeRequests.set(requestId, () => {
    if (cancelled) return false;
    cancelled = true;
    if (typeof stageAbort === 'function') stageAbort();
    activeRequests.delete(requestId);
    return true;
  });

  (async () => {
    const { baseUrl } = storage.ollamaConfig.get();
    let effectiveSystem = system;

    if (webSearchEnabled) {
      send('ollama:chat:progress', { requestId, stage: 'search', message: 'ウェブ検索中…' });
      const query = getLatestUserMessage(messages);
      const tavilyApiKey = getTavilyApiKey();

      if (!tavilyApiKey) {
        activeRequests.delete(requestId);
        send('ollama:chat:error', {
          requestId,
          error: 'Tavily API Key が設定されていないため、検索つき生成を開始できません。',
        });
        return;
      }

      if (query && tavilyApiKey) {
        const searchOptions = deriveSearchOptionsFromQuery(query);
        const searchReq = createTavilySearchRequest(tavilyApiKey, searchOptions.searchQuery, {
          topic: searchOptions.topic,
          days: searchOptions.days,
        });
        stageAbort = searchReq.abort;

        let searchData;
        try {
          searchData = await searchReq.promise;
        } catch (err) {
          if (!cancelled) {
            console.warn(`[tavily:${requestId}] search failed:`, err.message || err);
          }
          if (isLikelyInvalidTavilyKeyError(err)) {
            activeRequests.delete(requestId);
            send('ollama:chat:error', {
              requestId,
              error: 'Tavily API Key が無効です。設定を確認してください。',
            });
            return;
          }
          searchData = null;
        }

        stageAbort = null;
        if (cancelled) return;

        const normalized = normalizeTavilyResults(searchData, { recencyDays: searchOptions.recencyDays });
        if (normalized.answer || normalized.results.length > 0) {
          send('ollama:chat:progress', { requestId, stage: 'summarize', message: '検索結果を要約中…' });
          try {
            const summary = await summarizeSearchResultsWithModel(model, query, normalized, baseUrl);
            if (!cancelled) {
              const mergedSummary = summary || buildFallbackSummaryFromSearchData(query, normalized);
              effectiveSystem = mergeSystemWithSearchSummary(system, mergedSummary, normalized);
              emitSearchInfo(query, mergedSummary, normalized.results);
            }
          } catch (err) {
            if (!cancelled) {
              console.warn(`[tavily:${requestId}] summarize failed:`, err.message || err);
              const fallbackSummary = buildFallbackSummaryFromSearchData(query, normalized);
              effectiveSystem = mergeSystemWithSearchSummary(system, fallbackSummary, normalized);
              emitSearchInfo(query, fallbackSummary, normalized.results);
              const timeoutMessage = '要約がタイムアウトしたため、検索結果を直接反映して続行します…';
              const fallbackMessage = '要約に失敗したため検索結果を直接反映します…';
              send('ollama:chat:progress', {
                requestId,
                stage: 'summarize',
                message: isSummaryTimeoutError(err) ? timeoutMessage : fallbackMessage,
              });
            }
          }
        }
      }
    }

    if (cancelled) return;

    send('ollama:chat:progress', { requestId, stage: 'generating', message: '回答を生成中…' });
    ollamaChatStream(
      { requestId, model, messages, system: effectiveSystem, options, think: reasoningEnabled },
      (content) => send('ollama:chat:chunk', { requestId, content, done: false }),
      () => send('ollama:chat:chunk', { requestId, content: '', done: true }),
      (err) => send('ollama:chat:error', { requestId, error: err.message || err.code || '不明なエラー' }),
      { activeRequests, baseUrl },
      (thinking) => send('ollama:chat:thinking', { requestId, thinking }),
    );
  })().catch((err) => {
    if (cancelled) return;
    activeRequests.delete(requestId);
    send('ollama:chat:error', { requestId, error: err.message || err.code || '不明なエラー' });
  });
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
// IPC handlers — Tavily config
// ---------------------------------------------------------------------------

ipcMain.handle('tavily:get-config-status', () => {
  try {
    return getTavilyConfigStatus();
  } catch (err) {
    return { configured: false, source: 'none', error: err.message || String(err) };
  }
});

ipcMain.handle('tavily:save-api-key', (_event, apiKey) => {
  try {
    const configPath = writeTavilyApiKeyToLocalConfig(apiKey);
    return { ok: true, path: configPath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('tavily:delete-api-key', () => {
  try {
    const result = deleteTavilyApiKeyLocalConfig();
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
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
