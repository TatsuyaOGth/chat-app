'use strict';

const { createGenerationLifecycle } = window.GenerationLifecycle;
const { subscribeGenerationRouting } = window.RequestRouting;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Conversation history for the active session, sent to Ollama on each request. */
let messages = [];

/** Whether the assistant is currently generating a response. */
let isGenerating = false;

/** Monotonically increasing request counter used as request ID. */
let requestCounter = 0;

/** requestId of the currently in-flight generation, or null when idle. */
let currentRequestId = null;

/** Information about the current in-flight generation (if any). */
let activeGeneration = null;

/** Information about the current prompt edit UI (if any). */
let activePromptEdit = null;

/** Cached list of available Ollama model names (used by the model dropdown). */
let modelOptions = [];

/** All saved presets, in display order. Renamed to avoid clash with window.presets. */
let presetList = [];

/** ID of the currently selected preset, or null when editing unsaved values. */
let activePresetId = null;

/**
 * Working copy of the parameter values currently in the editor.
 * Edits modify this object only; the saved preset stays untouched until
 * the user clicks "上書き保存" or "新規プリセット".
 */
let workingParams = window.Params.emptyParams();

/** All sessions, in storage order (newest first). Renamed to avoid clash with window.sessions. */
let sessionList = [];

/**
 * ID of the active session.
 * `null` means "new chat in progress, not yet persisted" — the session record
 * is lazily created on the first user message so empty sessions never appear
 * in the sidebar.
 */
let activeSessionId = null;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const messagesEl = document.getElementById('messages');
const inputForm = document.getElementById('input-form');
const messageInput = document.getElementById('message-input');
const webSearchToggleWrap = document.getElementById('web-search-toggle-wrap');
const webSearchToggle = document.getElementById('web-search-toggle');
const sendBtn = document.getElementById('send-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusBar = document.getElementById('status-bar');
const newSessionBtn = document.getElementById('new-session-btn');
const sessionListEl = document.getElementById('session-list');
const settingsBtn = document.getElementById('settings-btn');

const presetSelect = document.getElementById('preset-select');
const paramEditor = document.getElementById('param-editor');
const savePresetBtn = document.getElementById('save-preset-btn');
const newPresetBtn = document.getElementById('new-preset-btn');
const presetNameInput = document.getElementById('preset-name-input');

const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsPresetList = document.getElementById('settings-preset-list');
const tavilyApiKeyInput = document.getElementById('tavily-api-key-input');
const tavilyApiKeySaveBtn = document.getElementById('tavily-api-key-save-btn');
const tavilyApiKeyDeleteBtn = document.getElementById('tavily-api-key-delete-btn');
const tavilyApiKeyStatus = document.getElementById('tavily-api-key-status');

const appEl = document.getElementById('app');
const leftPaneEl = document.getElementById('left-pane');
const rightPaneEl = document.getElementById('right-pane');
const leftPaneToggle = document.getElementById('left-pane-toggle');
const rightPaneToggle = document.getElementById('right-pane-toggle');

let isWebSearchAvailable = false;

// ─────────────────────────────────────────────────────────────────
// Markdown Configuration & Rendering
// ─────────────────────────────────────────────────────────────────

/**
 * Configure marked.js with GFM (GitHub Flavored Markdown) and highlight.js integration
 */
function configureMarked() {
  if (typeof marked === 'undefined' || typeof hljs === 'undefined') {
    console.warn('marked or highlight.js not loaded');
    return;
  }

  marked.setOptions({
    gfm: true,              // GitHub Flavored Markdown (テーブル、タスクリスト対応)
    breaks: false           // 単一改行を <br> にしない（マークダウン標準に従う）
  });

  marked.use({
    renderer: {
      code(token) {
        const code = token.text || '';
        const rawLang = (token.lang || '').trim().toLowerCase();
        const langMatch = rawLang.match(/^\S+/);
        const lang = langMatch ? langMatch[0] : '';
        const langClass = lang ? ` language-${escapeHtml(lang)}` : '';

        // 50000文字以上のコードはハイライトをスキップ（パフォーマンス対策）
        if (code.length > 50000) {
          return `<pre><code class="hljs${langClass}">${escapeHtml(code)}</code></pre>\n`;
        }

        if (lang && hljs.getLanguage(lang)) {
          try {
            const highlighted = hljs.highlight(code, { language: lang }).value;
            return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>\n`;
          } catch (err) {
            console.error('Highlight error:', err);
          }
        }

        try {
          const highlighted = hljs.highlightAuto(code).value;
          return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>\n`;
        } catch (err) {
          console.error('Auto-highlight error:', err);
          return `<pre><code class="hljs${langClass}">${escapeHtml(code)}</code></pre>\n`;
        }
      }
    }
  });
}

/**
 * Render markdown text to sanitized HTML
 * @param {string} text - Markdown text
 * @returns {string} Sanitized HTML
 */
function renderMarkdown(text) {
  if (!text) return '';

  // XSS 対策: DOMPurify が利用可能か確認
  if (typeof DOMPurify === 'undefined') {
    console.error('DOMPurify not loaded - falling back to escaped text');
    return escapeHtml(text);
  }

  // マークダウンを HTML に変換
  let html;
  try {
    html = marked.parse(text);
  } catch (err) {
    console.error('Markdown parse error:', err);
    return escapeHtml(text);
  }

  // XSS 対策: HTML をサニタイズ
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'strong', 'em', 'code', 'pre',
      'a', 'img',
      'ul', 'ol', 'li',
      'blockquote',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div'
    ],
    ALLOWED_ATTR: [
      'href', 'title', 'alt', 'src',
      'class', 'id',
      'start', 'type'  // ol の start 属性、type 属性
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
    FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur', 'style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|ftp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i  // javascript:, data: を除外
  });

  return clean;
}

/**
 * Escape HTML special characters (fallback for when DOMPurify is unavailable)
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function setStatus(text, level = 'info') {
  statusBar.textContent = text;
  statusBar.className = `status-bar status-bar--${level}`;
}

function setWebSearchAvailability(configured) {
  isWebSearchAvailable = !!configured;
  if (webSearchToggleWrap) {
    webSearchToggleWrap.hidden = !isWebSearchAvailable;
  }
  if (!isWebSearchAvailable && webSearchToggle) {
    webSearchToggle.checked = false;
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

async function loadModels() {
  setStatus('モデルを読み込み中…');
  try {
    const { models, error } = await window.ollama.getModels();
    if (error && (!models || models.length === 0)) {
      setStatus(`Ollama に接続できません: ${error}`, 'error');
      modelOptions = [];
    } else if (!models || models.length === 0) {
      setStatus('Ollama にモデルが見つかりません。`ollama pull <model>` を実行してください。', 'warn');
      modelOptions = [];
    } else {
      modelOptions = models;
      setStatus('');
    }
  } catch (err) {
    setStatus(`エラー: ${err.message}`, 'error');
    modelOptions = [];
  }
  renderEditor();
  updateSendButton();
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

async function loadPresets() {
  presetList = await window.presets.list();
  renderPresetSelect();
}

function renderPresetSelect() {
  presetSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '（新規 / 未保存）';
  presetSelect.appendChild(placeholder);

  for (const t of presetList) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    presetSelect.appendChild(opt);
  }

  presetSelect.value = activePresetId ?? '';
  savePresetBtn.disabled = !activePresetId;
}

function selectPreset(id) {
  activePresetId = id || null;
  if (activePresetId) {
    const t = presetList.find((tt) => tt.id === activePresetId);
    workingParams = { ...window.Params.emptyParams(), ...(t?.params || {}) };
    presetNameInput.value = t?.name ?? '';
  } else {
    workingParams = window.Params.emptyParams();
    presetNameInput.value = '';
  }
  renderPresetSelect();
  renderEditor();
  updateSendButton();
}

async function savePresetOverwrite() {
  if (!activePresetId) return;
  const name = presetNameInput.value.trim();
  const updated = await window.presets.update(activePresetId, {
    name: name || undefined,
    params: { ...workingParams },
  });
  if (!updated) return;
  await loadPresets();
  setStatus(`プリセット「${updated.name}」を更新しました`);
}

async function savePresetAsNew() {
  const name = presetNameInput.value.trim();
  if (!name) {
    setStatus('プリセット名を入力してください', 'warn');
    presetNameInput.focus();
    return;
  }
  const created = await window.presets.create({
    name,
    params: { ...workingParams },
  });
  activePresetId = created.id;
  await loadPresets();
  setStatus(`プリセット「${name}」を作成しました`);
}

// ---------------------------------------------------------------------------
// Parameter editor
// ---------------------------------------------------------------------------

function renderEditor() {
  window.Params.renderParamEditor(paramEditor, workingParams, {
    modelOptions,
    onReloadModels: loadModels,
    onChange: (key, value, opts = {}) => {
      workingParams = { ...workingParams, [key]: value };
      if (opts.rerender !== false) {
        renderEditor();
      }
      updateSendButton();
    },
  });
}

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

function setTavilyStatus(text, level = 'info') {
  if (!tavilyApiKeyStatus) return;
  tavilyApiKeyStatus.textContent = text;
  tavilyApiKeyStatus.className = 'tavily-settings__status';
  if (level === 'ok') tavilyApiKeyStatus.classList.add('tavily-settings__status--ok');
  if (level === 'warn') tavilyApiKeyStatus.classList.add('tavily-settings__status--warn');
  if (level === 'error') tavilyApiKeyStatus.classList.add('tavily-settings__status--error');
}

async function loadTavilyConfigStatus() {
  if (!window.tavily || !tavilyApiKeyInput) {
    setWebSearchAvailability(false);
    return;
  }
  setTavilyStatus('読み込み中…');
  try {
    const { configured, source, error } = await window.tavily.getConfigStatus();
    setWebSearchAvailability(configured);
    if (error) {
      setTavilyStatus(`状態取得エラー: ${error}`, 'error');
      return;
    }

    if (!configured) {
      tavilyApiKeyInput.value = '';
      tavilyApiKeyInput.placeholder = 'tvly-...';
      setTavilyStatus('未設定です', 'warn');
      return;
    }

    tavilyApiKeyInput.value = '';
    tavilyApiKeyInput.placeholder = source === 'env'
      ? '環境変数で設定済み（TAVILY_API_KEY）'
      : '保存済み（userData/tavily-config.json）';
    setTavilyStatus(source === 'env' ? '環境変数で設定済みです' : '設定ファイルに保存済みです', 'ok');
  } catch (err) {
    setWebSearchAvailability(false);
    setTavilyStatus(`状態取得エラー: ${err.message || String(err)}`, 'error');
  }
}

async function saveTavilyApiKeyFromSettings() {
  if (!window.tavily || !tavilyApiKeyInput) return;
  const apiKey = tavilyApiKeyInput.value.trim();
  if (!apiKey) {
    setTavilyStatus('API Key を入力してください', 'warn');
    tavilyApiKeyInput.focus();
    return;
  }

  tavilyApiKeySaveBtn.disabled = true;
  setTavilyStatus('保存中…');
  try {
    const { ok, error } = await window.tavily.saveApiKey(apiKey);
    if (!ok) {
      setTavilyStatus(`保存エラー: ${error || '不明なエラー'}`, 'error');
      return;
    }

    tavilyApiKeyInput.value = '';
    await loadTavilyConfigStatus();
    setTavilyStatus('保存しました（userData/tavily-config.json）', 'ok');
  } catch (err) {
    setTavilyStatus(`保存エラー: ${err.message || String(err)}`, 'error');
  } finally {
    tavilyApiKeySaveBtn.disabled = false;
  }
}

async function deleteTavilyApiKeyFromSettings() {
  if (!window.tavily) return;

  const confirmed = await window.app.confirm('保存済みの Tavily API Key を削除しますか？');
  if (!confirmed) return;

  tavilyApiKeyDeleteBtn.disabled = true;
  setTavilyStatus('削除中…');
  try {
    const { ok, error } = await window.tavily.deleteApiKey();
    if (!ok) {
      setTavilyStatus(`削除エラー: ${error || '不明なエラー'}`, 'error');
      return;
    }

    tavilyApiKeyInput.value = '';
    await loadTavilyConfigStatus();
    setTavilyStatus('保存済み API Key を削除しました', 'ok');
  } catch (err) {
    setTavilyStatus(`削除エラー: ${err.message || String(err)}`, 'error');
  } finally {
    tavilyApiKeyDeleteBtn.disabled = false;
  }
}

function openSettings() {
  renderSettingsPresetList();
  loadTavilyConfigStatus();
  if (typeof settingsModal.showModal === 'function') {
    settingsModal.showModal();
  } else {
    settingsModal.setAttribute('open', '');
  }
}

function closeSettings() {
  if (typeof settingsModal.close === 'function') {
    settingsModal.close();
  } else {
    settingsModal.removeAttribute('open');
  }
}

/**
 * Render the preset management list inside the settings modal.
 * Each row supports HTML5 drag-and-drop for reordering and a delete button.
 */
function renderSettingsPresetList() {
  settingsPresetList.innerHTML = '';

  if (presetList.length === 0) {
    const empty = document.createElement('li');
    empty.classList.add('preset-list__empty');
    empty.textContent = '保存されたプリセットはありません。右ペインで作成できます。';
    settingsPresetList.appendChild(empty);
    return;
  }

  for (const t of presetList) {
    settingsPresetList.appendChild(buildPresetListItem(t));
  }
}

function buildPresetListItem(preset) {
  const li = document.createElement('li');
  li.classList.add('preset-list__item');
  li.draggable = true;
  li.dataset.id = preset.id;

  const handle = document.createElement('span');
  handle.classList.add('preset-list__handle');
  handle.textContent = '≡';
  handle.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.classList.add('preset-list__name');
  name.textContent = preset.name;
  name.title = preset.name;

  const del = document.createElement('button');
  del.type = 'button';
  del.classList.add('preset-list__delete', 'btn', 'btn-danger');
  del.textContent = '削除';
  del.addEventListener('click', () => deletePresetFromSettings(preset.id));

  li.appendChild(handle);
  li.appendChild(name);
  li.appendChild(del);

  attachDragHandlers(li);
  return li;
}

async function deletePresetFromSettings(id) {
  const target = presetList.find((t) => t.id === id);
  if (!target) return;
  if (!await window.app.confirm(`プリセット「${target.name}」を削除しますか？`)) return;

  await window.presets.delete(id);

  // Drop selection if the active preset was deleted; the user is then
  // editing free-form params again.
  if (activePresetId === id) {
    activePresetId = null;
  }

  await loadPresets();
  renderSettingsPresetList();
}

// Drag-and-drop reordering ---------------------------------------------------

let dragSourceId = null;

function attachDragHandlers(li) {
  li.addEventListener('dragstart', (e) => {
    dragSourceId = li.dataset.id;
    li.classList.add('preset-list__item--dragging');
    // Required in Firefox to actually start a drag.
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.id);
    }
  });

  li.addEventListener('dragend', () => {
    dragSourceId = null;
    li.classList.remove('preset-list__item--dragging');
    settingsPresetList
      .querySelectorAll('.preset-list__item--drop-before, .preset-list__item--drop-after')
      .forEach((el) => {
        el.classList.remove('preset-list__item--drop-before');
        el.classList.remove('preset-list__item--drop-after');
      });
  });

  li.addEventListener('dragover', (e) => {
    if (!dragSourceId || dragSourceId === li.dataset.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('preset-list__item--drop-before', before);
    li.classList.toggle('preset-list__item--drop-after', !before);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('preset-list__item--drop-before');
    li.classList.remove('preset-list__item--drop-after');
  });

  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragSourceId || dragSourceId === li.dataset.id) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    await reorderPresets(dragSourceId, li.dataset.id, before);
  });
}

async function reorderPresets(sourceId, targetId, insertBefore) {
  const ids = presetList.map((t) => t.id);
  const filtered = ids.filter((id) => id !== sourceId);
  const targetIdx = filtered.indexOf(targetId);
  if (targetIdx === -1) return;
  const insertAt = insertBefore ? targetIdx : targetIdx + 1;
  filtered.splice(insertAt, 0, sourceId);

  await window.presets.reorder(filtered);
  await loadPresets();
  renderSettingsPresetList();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function loadSessions() {
  sessionList = await window.sessions.list();
  renderSessionList();
}

function renderSessionList() {
  sessionListEl.innerHTML = '';

  if (sessionList.length === 0) {
    const hint = document.createElement('p');
    hint.classList.add('hint');
    hint.textContent = '会話を始めると履歴がここに表示されます';
    sessionListEl.appendChild(hint);
    return;
  }

  for (const s of sessionList) {
    const item = document.createElement('div');
    item.classList.add('session-item');
    if (s.id === activeSessionId) item.classList.add('session-item--active');
    item.dataset.sessionId = s.id;

    const title = document.createElement('button');
    title.type = 'button';
    title.classList.add('session-item__title');
    title.textContent = s.title || '（無題）';
    title.title = s.title || '（無題）';
    title.addEventListener('click', () => loadSession(s.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.classList.add('session-item__delete');
    del.textContent = '×';
    del.title = '削除';
    del.setAttribute('aria-label', `「${s.title || '無題'}」を削除`);
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    item.appendChild(title);
    item.appendChild(del);
    sessionListEl.appendChild(item);
  }
}

async function loadSession(id) {
  if (isGenerating) return;
  const session = await window.sessions.get(id);
  if (!session) return;

  activeSessionId = id;
  messages = (session.messages || []).map((m) => {
    // Strip any persisted UI-only fields before re-rendering.
    if (m.role === 'assistant') {
      return { role: m.role, content: m.content, paramsSnapshot: m.paramsSnapshot };
    }
    return { role: m.role, content: m.content };
  });

  // Re-render messages
  messagesEl.innerHTML = '';
  for (const m of messages) {
    const el = appendMessage(m.role, m.content);
    if (m.role === 'user') {
      attachUserEditButton(el, m);
    }
    if (m.role === 'assistant') {
      attachAssistantButtons(el, m.paramsSnapshot || null);
    }
  }

  renderSessionList();
  setStatus('');
}

async function deleteSession(id) {
  if (!await window.app.confirm('このセッションを削除しますか？')) return;
  await window.sessions.delete(id);
  if (activeSessionId === id) {
    activeSessionId = null;
    messages = [];
    messagesEl.innerHTML = '';
  }
  await loadSessions();
}

/**
 * The conversation history we send to Ollama uses only `role` and `content`.
 * `paramsSnapshot` is a UI/audit field and must be stripped first.
 */
function messagesForRequest() {
  return messages.map(({ role, content }) => ({ role, content }));
}

/** Derive a session title from a user message (first ~30 chars, single line). */
function deriveTitle(text) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 30 ? `${oneLine.slice(0, 30)}…` : oneLine;
}

/** Lazily create the session record on the first user message. */
async function ensureSession(firstUserText) {
  if (activeSessionId) return activeSessionId;
  const session = await window.sessions.create({
    presetId: activePresetId,
    title: deriveTitle(firstUserText),
  });
  activeSessionId = session.id;
  await loadSessions();
  return session.id;
}

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

/**
 * Create the "thinking / loading" indicator shown while waiting for the
 * first token.  The label defaults to「考え中...」and is updated to
 * 「モデルをロード中...」once the /api/ps check resolves.
 */
function createThinkingIndicator() {
  const el = document.createElement('div');
  el.classList.add('thinking-indicator');

  const label = document.createElement('span');
  label.classList.add('thinking-indicator__label');
  label.textContent = '考え中...';

  const dots = document.createElement('span');
  dots.classList.add('thinking-indicator__dots');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));

  el.appendChild(dots);
  el.appendChild(label);
  return el;
}

function appendMessage(role, initialText) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('message', `message--${role}`);

  const labelEl = document.createElement('span');
  labelEl.classList.add('message__role');
  labelEl.textContent = role === 'user' ? 'You' : 'Assistant';

  const content = document.createElement('div');
  content.classList.add('message__content');
  content.dataset.raw = initialText;
  content.innerHTML = renderMarkdown(initialText);

  wrapper.appendChild(labelEl);
  wrapper.appendChild(content);
  messagesEl.appendChild(wrapper);
  return wrapper; // return the whole wrapper so callers can attach extras
}

function upsertSearchInfoPanel(wrapper, payload) {
  if (!payload) return;
  const summaryText = typeof payload.summary === 'string' ? payload.summary.trim() : '';
  const results = Array.isArray(payload.results) ? payload.results : [];
  if (!summaryText && results.length === 0) return;

  let details = wrapper.querySelector('.search-info');
  if (!details) {
    details = document.createElement('details');
    details.classList.add('search-info');

    const summary = document.createElement('summary');
    summary.classList.add('search-info__toggle');
    summary.textContent = '検索結果と要約';
    details.appendChild(summary);

    const body = document.createElement('div');
    body.classList.add('search-info__body');
    details.appendChild(body);

    wrapper.appendChild(details);
  }

  const bodyEl = details.querySelector('.search-info__body');
  if (!bodyEl) return;
  bodyEl.innerHTML = '';

  if (summaryText) {
    const summaryHeading = document.createElement('p');
    summaryHeading.classList.add('search-info__heading');
    summaryHeading.textContent = '要約';
    bodyEl.appendChild(summaryHeading);

    const summaryContent = document.createElement('pre');
    summaryContent.classList.add('search-info__summary');
    summaryContent.textContent = summaryText;
    bodyEl.appendChild(summaryContent);
  }

  if (results.length > 0) {
    const listHeading = document.createElement('p');
    listHeading.classList.add('search-info__heading');
    listHeading.textContent = '検索結果';
    bodyEl.appendChild(listHeading);

    const list = document.createElement('ol');
    list.classList.add('search-info__list');
    for (const item of results) {
      const li = document.createElement('li');
      li.classList.add('search-info__item');

      const title = document.createElement('a');
      title.classList.add('search-info__link');
      title.textContent = item.title || item.url || '(no title)';
      title.href = item.url || '#';
      title.target = '_blank';
      title.rel = 'noreferrer noopener';

      const snippet = document.createElement('p');
      snippet.classList.add('search-info__snippet');
      snippet.textContent = item.snippet || '(snippet unavailable)';

      li.appendChild(title);
      li.appendChild(snippet);
      list.appendChild(li);
    }
    bodyEl.appendChild(list);
  }
}

function getChatRequestParams() {
  const { model, system, options } = window.Params.splitParamsForChat(workingParams);
  if (!model) {
    setStatus('右ペインでモデルを選択してください', 'warn');
    return null;
  }
  return { model, system, options };
}

function setMessageContent(contentEl, text) {
  contentEl.dataset.raw = text;
  contentEl.innerHTML = renderMarkdown(text);
}

function attachUserEditButton(wrapper, userMsg) {
  if (wrapper.querySelector('.message__edit-btn')) return;

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.classList.add('message__edit-btn');
  editBtn.textContent = '✎';
  editBtn.title = 'プロンプトを編集';
  editBtn.setAttribute('aria-label', 'プロンプトを編集');
  editBtn.addEventListener('click', () => {
    openUserPromptEdit(wrapper, userMsg);
  });
  wrapper.appendChild(editBtn);
}

function closeActivePromptEdit() {
  if (!activePromptEdit) return;
  const { wrapper, userMsg, originalText } = activePromptEdit;
  const contentEl = wrapper.querySelector('.message__content');
  if (contentEl) setMessageContent(contentEl, userMsg?.content ?? originalText);
  wrapper.classList.remove('message--editing');
  activePromptEdit = null;
}

function openUserPromptEdit(wrapper, userMsg) {
  if (activePromptEdit && activePromptEdit.wrapper !== wrapper) {
    closeActivePromptEdit();
  }

  const contentEl = wrapper.querySelector('.message__content');
  if (!contentEl) return;
  const originalText = userMsg.content || '';

  wrapper.classList.add('message--editing');
  contentEl.innerHTML = '';

  const form = document.createElement('div');
  form.classList.add('message__edit-form');

  const textarea = document.createElement('textarea');
  textarea.classList.add('message__edit-input');
  textarea.value = originalText;
  textarea.setAttribute('aria-label', 'プロンプト編集');

  const actions = document.createElement('div');
  actions.classList.add('message__edit-actions');

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.classList.add('message__edit-action', 'message__edit-action--done');
  doneBtn.textContent = '再送';
  doneBtn.title = '完了';
  doneBtn.setAttribute('aria-label', '編集を完了');

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.classList.add('message__edit-action', 'message__edit-action--cancel');
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.title = 'キャンセル';
  cancelBtn.setAttribute('aria-label', '編集をキャンセル');

  actions.appendChild(doneBtn);
  actions.appendChild(cancelBtn);
  form.appendChild(textarea);
  form.appendChild(actions);
  contentEl.appendChild(form);

  activePromptEdit = { wrapper, userMsg, originalText };

  const finishEdit = () => {
    closeActivePromptEdit();
  };

  cancelBtn.addEventListener('click', finishEdit);

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doneBtn.click();
    }
  });

  doneBtn.addEventListener('click', async () => {
    const nextText = textarea.value.trim();
    if (!nextText) {
      setStatus('プロンプトは空にできません', 'warn');
      textarea.focus();
      return;
    }
    if (nextText === originalText) {
      finishEdit();
      return;
    }
    await applyPromptEdit(userMsg, wrapper, nextText);
    finishEdit();
  });

  textarea.focus();
  textarea.selectionStart = textarea.value.length;
  textarea.selectionEnd = textarea.value.length;
}

async function cancelActiveGenerationForEdit() {
  if (!activeGeneration || currentRequestId === null) return;
  activeGeneration.discardAssistantBubble = true;
  activeGeneration.suppressCancelledStatus = true;
  window.ollama.cancel(currentRequestId);
  await activeGeneration.finished;
}

async function applyPromptEdit(userMsg, wrapper, nextText) {
  const userIdx = messages.indexOf(userMsg);
  if (userIdx === -1 || !activeSessionId) return;

  await cancelActiveGenerationForEdit();

  const previousText = userMsg.content;
  const previousMessages = messages;
  const truncatedMessages = previousMessages.slice(0, userIdx + 1);

  userMsg.content = nextText;
  messages = truncatedMessages;

  try {
    const saved = await window.sessions.update(activeSessionId, { messages });
    if (!saved) throw new Error('セッションへの保存に失敗しました');
  } catch (err) {
    userMsg.content = previousText;
    messages = previousMessages;
    const errorMessage = err instanceof Error
      ? (err.message || '不明なエラー')
      : (String(err) || '不明なエラー');
    setStatus(`セッション保存エラー: ${errorMessage}`, 'error');
    return;
  }

  const contentEl = wrapper.querySelector('.message__content');
  if (contentEl) setMessageContent(contentEl, nextText);

  let node = wrapper.nextElementSibling;
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }

  const chatParams = getChatRequestParams();
  if (!chatParams) return;
  const paramsSnapshot = JSON.parse(JSON.stringify(workingParams));
  await startAssistantGeneration({
    sessionId: activeSessionId,
    ...chatParams,
    paramsSnapshot,
  });
}

/**
 * Attach a copy button and optional "ⓘ" params button to an assistant message.
 * The popover hover is scoped to the info wrapper only, so the copy button
 * does not accidentally trigger it.
 */
function attachAssistantButtons(wrapper, snapshot) {
  if (wrapper.querySelector('.message__settings-container')) return;

  const container = document.createElement('div');
  container.classList.add('message__settings-container');

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.classList.add('message__copy-btn');
  copyBtn.textContent = '⧉';
  copyBtn.title = '応答をコピー';
  copyBtn.setAttribute('aria-label', '応答をコピー');
  copyBtn.addEventListener('click', () => {
    const contentEl = wrapper.querySelector('.message__content');
    const text = contentEl.dataset.raw || contentEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✓';
      setTimeout(() => { copyBtn.textContent = '⧉'; }, 1500);
    });
  });
  container.appendChild(copyBtn);

  if (snapshot) {
    const infoWrapper = document.createElement('div');
    infoWrapper.classList.add('message__info-wrapper');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.add('message__settings-btn');
    btn.textContent = 'ⓘ';
    btn.title = 'この応答に使用した設定';
    btn.setAttribute('aria-label', 'この応答に使用した設定を表示');

    const popover = document.createElement('div');
    popover.classList.add('params-popover');
    popover.appendChild(buildSnapshotTable(snapshot));

    infoWrapper.appendChild(btn);
    infoWrapper.appendChild(popover);
    container.appendChild(infoWrapper);
  }

  wrapper.appendChild(container);
}

function buildSnapshotTable(snapshot) {
  const table = document.createElement('table');
  table.classList.add('params-popover__table');

  const customized = Object.entries(snapshot).filter(([, v]) => window.Params.isCustomized(v));
  if (customized.length === 0) {
    const p = document.createElement('p');
    p.classList.add('params-popover__empty');
    p.textContent = '（すべて Ollama デフォルト）';
    return p;
  }

  for (const [key, value] of customized) {
    const tr = document.createElement('tr');

    const th = document.createElement('th');
    th.textContent = key;

    const td = document.createElement('td');
    const display = typeof value === 'string' ? value : JSON.stringify(value);
    td.textContent = display.length > 80 ? `${display.slice(0, 80)}…` : display;
    td.title = display;

    tr.appendChild(th);
    tr.appendChild(td);
    table.appendChild(tr);
  }
  return table;
}


// ---------------------------------------------------------------------------
// Send / receive
// ---------------------------------------------------------------------------

function updateSendButton() {
  const hasText = messageInput.value.trim().length > 0;
  const hasModel = window.Params.isCustomized(workingParams.model);
  sendBtn.disabled = !hasText || !hasModel || isGenerating;
}

function statusTextForStage(stage, fallback) {
  if (fallback && fallback.trim()) return fallback;
  switch (stage) {
    case 'search':
      return 'ウェブ検索中…';
    case 'summarize':
      return '検索結果を要約中…';
    case 'generating':
      return '回答を生成中…';
    default:
      return '生成中…';
  }
}

async function startAssistantGeneration({ sessionId, model, system, options, paramsSnapshot, webSearchEnabled }) {
  const assistantWrapper = appendMessage('assistant', '');
  const assistantContent = assistantWrapper.querySelector('.message__content');
  isGenerating = true;
  sendBtn.disabled = true;
  cancelBtn.style.display = '';
  setStatus(webSearchEnabled ? 'ウェブ検索を開始中…' : '生成中…');

  // Thinking indicator — shown until first content chunk arrives.
  const thinkingEl = createThinkingIndicator();
  assistantContent.appendChild(thinkingEl);

  // Async: determine whether the model is already loaded and update label.
  const requestId = String(++requestCounter);
  currentRequestId = requestId;
  let finishResolve;
  const finished = new Promise((resolve) => { finishResolve = resolve; });

  const generation = {
    requestId,
    assistantWrapper,
    discardAssistantBubble: false,
    suppressCancelledStatus: false,
    finished,
  };
  activeGeneration = generation;

  let lifecycle;
  const routing = subscribeGenerationRouting({
    ollama: window.ollama,
    requestId,
    onChunk: (data) => lifecycle.handleChunk(data),
    onError: (data) => lifecycle.handleError(data),
    onProgress: (data) => {
      setStatus(statusTextForStage(data.stage, data.message));
      if (data.stage === 'generating') {
        const label = lifecycle.updateThinkingLabel(true);
        if (label) {
          const labelEl = thinkingEl.querySelector('.thinking-indicator__label');
          if (labelEl) labelEl.textContent = label;
        }
      }
    },
    onSearchInfo: (data) => {
      upsertSearchInfoPanel(assistantWrapper, data);
    },
  });

  lifecycle = createGenerationLifecycle({
    requestId,
    generation,
    paramsSnapshot,
    sessionId,
    clearUiState: (active) => {
      isGenerating = false;
      currentRequestId = null;
      cancelBtn.style.display = 'none';
      if (activeGeneration === active) activeGeneration = null;
    },
    onRemoveThinking: () => {
      thinkingEl.remove();
    },
    onAppendContent: (responseText) => {
      assistantContent.dataset.raw = responseText;
      assistantContent.innerHTML = renderMarkdown(responseText);
    },
    onCancelled: ({ generation: currentGeneration, responseText }) => {
      if (!currentGeneration.discardAssistantBubble && !responseText) {
        assistantContent.textContent = '[キャンセル]';
        assistantContent.classList.add('message__content--error');
      }
      if (!currentGeneration.suppressCancelledStatus) {
        setStatus('生成をキャンセルしました', 'warn');
      }
    },
    onError: (error) => {
      assistantContent.textContent = `[エラー: ${error}]`;
      assistantContent.classList.add('message__content--error');
      setStatus(`エラー: ${error}`, 'error');
    },
    onPersistAssistant: async ({ sessionId: currentSessionId, paramsSnapshot: currentParamsSnapshot, responseText }) => {
      const assistantMsg = {
        role: 'assistant',
        content: responseText,
        paramsSnapshot: currentParamsSnapshot,
      };
      messages.push(assistantMsg);
      attachAssistantButtons(assistantWrapper, currentParamsSnapshot);
      try {
        await window.sessions.appendMessage(currentSessionId, assistantMsg);
        await loadSessions();
        setStatus('');
      } catch {
        setStatus('応答の保存に失敗しました（表示は正常です）', 'warn');
      }
    },
    onDiscardAssistant: (active) => {
      active.assistantWrapper.remove();
    },
    onAfterFinish: () => {
      updateSendButton();
    },
    onFinishResolved: () => {
      finishResolve();
    },
    unsubChunk: routing.unsubChunk,
    unsubError: routing.unsubError,
    unsubProgress: routing.unsubProgress,
    unsubSearchInfo: routing.unsubSearchInfo,
  });

  window.ollama.checkLoaded(model).then(({ loaded }) => {
    const label = lifecycle.updateThinkingLabel(loaded);
    if (label) {
      const labelEl = thinkingEl.querySelector('.thinking-indicator__label');
      if (labelEl) labelEl.textContent = label;
    }
  }).catch(() => { /* ignore; label stays at default */ });

  window.ollama.chat(requestId, {
    model,
    messages: messagesForRequest(),
    system,
    options,
    webSearchEnabled,
  });
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isGenerating) return;

  const chatParams = getChatRequestParams();
  if (!chatParams) return;

  // Snapshot the params at the moment generation starts, so edits made during
  // the response don't leak into this assistant turn's audit trail.
  const paramsSnapshot = JSON.parse(JSON.stringify(workingParams));
  const webSearchEnabled = isWebSearchAvailable && !!(webSearchToggle && webSearchToggle.checked);

  // Render user message
  const userMsg = { role: 'user', content: text };
  messages.push(userMsg);
  const userMsgEl = appendMessage('user', text);
  attachUserEditButton(userMsgEl, userMsg);
  const elRect = userMsgEl.getBoundingClientRect();
  const containerRect = messagesEl.getBoundingClientRect();
  messagesEl.scrollTo({ top: messagesEl.scrollTop + elRect.top - containerRect.top, behavior: 'smooth' });
  messageInput.value = '';
  updateSendButton();

  let sessionId;
  try {
    sessionId = await ensureSession(text);
    const savedSession = await window.sessions.appendMessage(sessionId, userMsg);
    if (!savedSession) throw new Error('セッションへの保存に失敗しました');
  } catch (err) {
    messages.pop();
    userMsgEl.remove();
    messageInput.value = text;
    updateSendButton();
    const errorMessage = err instanceof Error
      ? (err.message || '不明なエラー')
      : (String(err) || '不明なエラー');
    setStatus(`セッション保存エラー: ${errorMessage}`, 'error');
    return;
  }

  await startAssistantGeneration({
    sessionId,
    ...chatParams,
    paramsSnapshot,
    webSearchEnabled,
  });
}

// ---------------------------------------------------------------------------
// New chat
// ---------------------------------------------------------------------------

function startNewChat() {
  if (isGenerating) return;
  closeActivePromptEdit();
  activeSessionId = null;
  messages = [];
  messagesEl.innerHTML = '';
  setStatus('');
  renderSessionList();
  messageInput.focus();
}

// ---------------------------------------------------------------------------
// Pane collapse
// ---------------------------------------------------------------------------

const PANE_STATE_KEY = 'paneCollapsed';

function applyPaneState(state) {
  const leftCollapsed = !!state.left;
  const rightCollapsed = !!state.right;
  appEl.classList.toggle('left-collapsed', leftCollapsed);
  appEl.classList.toggle('right-collapsed', rightCollapsed);
  leftPaneEl.classList.toggle('collapsed', leftCollapsed);
  rightPaneEl.classList.toggle('collapsed', rightCollapsed);
  leftPaneToggle.textContent = leftCollapsed ? '▶' : '◀';
  leftPaneToggle.setAttribute('aria-label', leftCollapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ');
  leftPaneToggle.setAttribute('title', leftCollapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ');
  rightPaneToggle.textContent = rightCollapsed ? '◀' : '▶';
  rightPaneToggle.setAttribute('aria-label', rightCollapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ');
  rightPaneToggle.setAttribute('title', rightCollapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ');
}

function togglePane(side) {
  let state = {};
  try { state = JSON.parse(localStorage.getItem(PANE_STATE_KEY) || '{}'); } catch (_) {}
  state[side] = !state[side];
  try { localStorage.setItem(PANE_STATE_KEY, JSON.stringify(state)); } catch (_) {}
  applyPaneState(state);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

newSessionBtn.addEventListener('click', startNewChat);

leftPaneToggle.addEventListener('click', () => togglePane('left'));
rightPaneToggle.addEventListener('click', () => togglePane('right'));

settingsBtn.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
// Click outside the inner content (the dialog backdrop) closes the modal.
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

presetSelect.addEventListener('change', () => selectPreset(presetSelect.value));
savePresetBtn.addEventListener('click', savePresetOverwrite);
newPresetBtn.addEventListener('click', savePresetAsNew);
tavilyApiKeySaveBtn.addEventListener('click', saveTavilyApiKeyFromSettings);
tavilyApiKeyDeleteBtn.addEventListener('click', deleteTavilyApiKeyFromSettings);
tavilyApiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveTavilyApiKeyFromSettings();
  }
});

cancelBtn.addEventListener('click', () => {
  if (currentRequestId !== null) {
    window.ollama.cancel(currentRequestId);
  }
});

messageInput.addEventListener('input', updateSendButton);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

inputForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async function init() {
  // Initialize markdown rendering
  configureMarked();

  // Restore pane collapse state
  let paneState = {};
  try { paneState = JSON.parse(localStorage.getItem(PANE_STATE_KEY) || '{}'); } catch (_) {}
  applyPaneState(paneState);

  renderEditor();
  await loadTavilyConfigStatus();
  await Promise.all([loadModels(), loadPresets(), loadSessions()]);
  messageInput.focus();
})();
