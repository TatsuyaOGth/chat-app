'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Conversation history for the active session, sent to Ollama on each request. */
let messages = [];

/** Whether the assistant is currently generating a response. */
let isGenerating = false;

/** Monotonically increasing request counter used as request ID. */
let requestCounter = 0;

/** Cached list of available Ollama model names (used by the model dropdown). */
let modelOptions = [];

/** All saved templates, in display order. Renamed to avoid clash with window.templates. */
let templateList = [];

/** ID of the currently selected template, or null when editing unsaved values. */
let activeTemplateId = null;

/**
 * Working copy of the parameter values currently in the editor.
 * Edits modify this object only; the saved template stays untouched until
 * the user clicks "上書き保存" or "新規テンプレート".
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
const sendBtn = document.getElementById('send-btn');
const statusBar = document.getElementById('status-bar');
const newSessionBtn = document.getElementById('new-session-btn');
const sessionListEl = document.getElementById('session-list');
const settingsBtn = document.getElementById('settings-btn');

const templateSelect = document.getElementById('template-select');
const paramEditor = document.getElementById('param-editor');
const saveTemplateBtn = document.getElementById('save-template-btn');
const newTemplateBtn = document.getElementById('new-template-btn');
const templateNameInput = document.getElementById('template-name-input');

const settingsModal = document.getElementById('settings-modal');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsTemplateList = document.getElementById('settings-template-list');

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
    breaks: false,          // 単一改行を <br> にしない（マークダウン標準に従う）
    highlight: function(code, lang) {
      // 50000文字以上のコードはハイライトをスキップ（パフォーマンス対策）
      if (code.length > 50000) {
        return code;
      }

      // 言語が指定されている場合
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (err) {
          console.error('Highlight error:', err);
        }
      }

      // 自動言語検出
      try {
        return hljs.highlightAuto(code).value;
      } catch (err) {
        console.error('Auto-highlight error:', err);
        return code;
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
// Templates
// ---------------------------------------------------------------------------

async function loadTemplates() {
  templateList = await window.templates.list();
  renderTemplateSelect();
}

function renderTemplateSelect() {
  templateSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '（新規 / 未保存）';
  templateSelect.appendChild(placeholder);

  for (const t of templateList) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    templateSelect.appendChild(opt);
  }

  templateSelect.value = activeTemplateId ?? '';
  saveTemplateBtn.disabled = !activeTemplateId;
}

function selectTemplate(id) {
  activeTemplateId = id || null;
  if (activeTemplateId) {
    const t = templateList.find((tt) => tt.id === activeTemplateId);
    workingParams = { ...window.Params.emptyParams(), ...(t?.params || {}) };
    templateNameInput.value = t?.name ?? '';
  } else {
    workingParams = window.Params.emptyParams();
    templateNameInput.value = '';
  }
  renderTemplateSelect();
  renderEditor();
  updateSendButton();
}

async function saveTemplateOverwrite() {
  if (!activeTemplateId) return;
  const name = templateNameInput.value.trim();
  const updated = await window.templates.update(activeTemplateId, {
    name: name || undefined,
    params: { ...workingParams },
  });
  if (!updated) return;
  await loadTemplates();
  setStatus(`テンプレート「${updated.name}」を更新しました`);
}

async function saveTemplateAsNew() {
  const name = templateNameInput.value.trim();
  if (!name) {
    setStatus('テンプレート名を入力してください', 'warn');
    templateNameInput.focus();
    return;
  }
  const created = await window.templates.create({
    name,
    params: { ...workingParams },
  });
  activeTemplateId = created.id;
  await loadTemplates();
  setStatus(`テンプレート「${name}」を作成しました`);
}

// ---------------------------------------------------------------------------
// Parameter editor
// ---------------------------------------------------------------------------

function renderEditor() {
  window.Params.renderParamEditor(paramEditor, workingParams, {
    modelOptions,
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

function openSettings() {
  renderSettingsTemplateList();
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
 * Render the template management list inside the settings modal.
 * Each row supports HTML5 drag-and-drop for reordering and a delete button.
 */
function renderSettingsTemplateList() {
  settingsTemplateList.innerHTML = '';

  if (templateList.length === 0) {
    const empty = document.createElement('li');
    empty.classList.add('template-list__empty');
    empty.textContent = '保存されたテンプレートはありません。右ペインで作成できます。';
    settingsTemplateList.appendChild(empty);
    return;
  }

  for (const t of templateList) {
    settingsTemplateList.appendChild(buildTemplateListItem(t));
  }
}

function buildTemplateListItem(template) {
  const li = document.createElement('li');
  li.classList.add('template-list__item');
  li.draggable = true;
  li.dataset.id = template.id;

  const handle = document.createElement('span');
  handle.classList.add('template-list__handle');
  handle.textContent = '≡';
  handle.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.classList.add('template-list__name');
  name.textContent = template.name;
  name.title = template.name;

  const del = document.createElement('button');
  del.type = 'button';
  del.classList.add('template-list__delete', 'btn', 'btn-danger');
  del.textContent = '削除';
  del.addEventListener('click', () => deleteTemplateFromSettings(template.id));

  li.appendChild(handle);
  li.appendChild(name);
  li.appendChild(del);

  attachDragHandlers(li);
  return li;
}

async function deleteTemplateFromSettings(id) {
  const target = templateList.find((t) => t.id === id);
  if (!target) return;
  if (!await window.app.confirm(`テンプレート「${target.name}」を削除しますか？`)) return;

  await window.templates.delete(id);

  // Drop selection if the active template was deleted; the user is then
  // editing free-form params again.
  if (activeTemplateId === id) {
    activeTemplateId = null;
  }

  await loadTemplates();
  renderSettingsTemplateList();
}

// Drag-and-drop reordering ---------------------------------------------------

let dragSourceId = null;

function attachDragHandlers(li) {
  li.addEventListener('dragstart', (e) => {
    dragSourceId = li.dataset.id;
    li.classList.add('template-list__item--dragging');
    // Required in Firefox to actually start a drag.
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.id);
    }
  });

  li.addEventListener('dragend', () => {
    dragSourceId = null;
    li.classList.remove('template-list__item--dragging');
    settingsTemplateList
      .querySelectorAll('.template-list__item--drop-before, .template-list__item--drop-after')
      .forEach((el) => {
        el.classList.remove('template-list__item--drop-before');
        el.classList.remove('template-list__item--drop-after');
      });
  });

  li.addEventListener('dragover', (e) => {
    if (!dragSourceId || dragSourceId === li.dataset.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    li.classList.toggle('template-list__item--drop-before', before);
    li.classList.toggle('template-list__item--drop-after', !before);
  });

  li.addEventListener('dragleave', () => {
    li.classList.remove('template-list__item--drop-before');
    li.classList.remove('template-list__item--drop-after');
  });

  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragSourceId || dragSourceId === li.dataset.id) return;
    const rect = li.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    await reorderTemplates(dragSourceId, li.dataset.id, before);
  });
}

async function reorderTemplates(sourceId, targetId, insertBefore) {
  const ids = templateList.map((t) => t.id);
  const filtered = ids.filter((id) => id !== sourceId);
  const targetIdx = filtered.indexOf(targetId);
  if (targetIdx === -1) return;
  const insertAt = insertBefore ? targetIdx : targetIdx + 1;
  filtered.splice(insertAt, 0, sourceId);

  await window.templates.reorder(filtered);
  await loadTemplates();
  renderSettingsTemplateList();
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
    if (m.role === 'assistant' && m.paramsSnapshot) {
      attachParamsSnapshotButton(el, m.paramsSnapshot);
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
    templateId: activeTemplateId,
    title: deriveTitle(firstUserText),
  });
  activeSessionId = session.id;
  await loadSessions();
  return session.id;
}

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

function appendMessage(role, initialText) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('message', `message--${role}`);

  const labelEl = document.createElement('span');
  labelEl.classList.add('message__role');
  labelEl.textContent = role === 'user' ? 'You' : 'Assistant';

  const content = document.createElement('div');
  content.classList.add('message__content');
  content.innerHTML = renderMarkdown(initialText);

  wrapper.appendChild(labelEl);
  wrapper.appendChild(content);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper; // return the whole wrapper so callers can attach extras
}

/**
 * Attach a small "ⓘ" button to an assistant message wrapper that, when
 * clicked, toggles a popover showing which params were used to generate it.
 */
function attachParamsSnapshotButton(wrapper, snapshot) {
  // Avoid duplicate buttons if called twice.
  if (wrapper.querySelector('.message__settings-btn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('message__settings-btn');
  btn.textContent = 'ⓘ';
  btn.title = 'この応答に使用した設定';
  btn.setAttribute('aria-label', 'この応答に使用した設定を表示');

  const popover = document.createElement('div');
  popover.classList.add('params-popover');
  popover.hidden = true;
  popover.appendChild(buildSnapshotTable(snapshot));

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    popover.hidden = !popover.hidden;
  });

  // Click outside closes it.
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== btn) {
      popover.hidden = true;
    }
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(popover);
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

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Send / receive
// ---------------------------------------------------------------------------

function updateSendButton() {
  const hasText = messageInput.value.trim().length > 0;
  const hasModel = window.Params.isCustomized(workingParams.model);
  sendBtn.disabled = !hasText || !hasModel || isGenerating;
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || isGenerating) return;

  const { model, system, options } = window.Params.splitParamsForChat(workingParams);
  if (!model) {
    setStatus('右ペインでモデルを選択してください', 'warn');
    return;
  }

  // Snapshot the params at the moment generation starts, so edits made during
  // the response don't leak into this assistant turn's audit trail.
  const paramsSnapshot = JSON.parse(JSON.stringify(workingParams));

  // Render user message + persist
  const userMsg = { role: 'user', content: text };
  messages.push(userMsg);
  appendMessage('user', text);
  messageInput.value = '';
  updateSendButton();

  const sessionId = await ensureSession(text);
  await window.sessions.appendMessage(sessionId, userMsg);

  // Prepare assistant bubble
  const assistantWrapper = appendMessage('assistant', '');
  const assistantContent = assistantWrapper.querySelector('.message__content');
  isGenerating = true;
  sendBtn.disabled = true;
  setStatus('生成中…');

  const requestId = String(++requestCounter);
  let responseText = '';
  let done = false;

  const unsubChunk = window.ollama.onChatChunk(({ requestId: rid, content, done: isDone }) => {
    if (rid !== requestId) return;
    if (content) {
      responseText += content;
      assistantContent.innerHTML = renderMarkdown(responseText);
      scrollToBottom();
    }
    if (isDone) {
      done = true;
      finish();
    }
  });

  const unsubError = window.ollama.onChatError(({ requestId: rid, error }) => {
    if (rid !== requestId) return;
    assistantContent.textContent = `[エラー: ${error}]`;
    assistantContent.classList.add('message__content--error');
    setStatus(`エラー: ${error}`, 'error');
    finish();
  });

  async function finish() {
    unsubChunk();
    unsubError();
    isGenerating = false;
    if (done && responseText) {
      const assistantMsg = {
        role: 'assistant',
        content: responseText,
        paramsSnapshot,
      };
      messages.push(assistantMsg);
      attachParamsSnapshotButton(assistantWrapper, paramsSnapshot);
      await window.sessions.appendMessage(sessionId, assistantMsg);
      // Refresh the session list so updatedAt-driven order changes if any.
      await loadSessions();
      setStatus('');
    }
    updateSendButton();
  }

  window.ollama.chat(requestId, {
    model,
    messages: messagesForRequest(),
    system,
    options,
  });
}

// ---------------------------------------------------------------------------
// New chat
// ---------------------------------------------------------------------------

function startNewChat() {
  if (isGenerating) return;
  activeSessionId = null;
  messages = [];
  messagesEl.innerHTML = '';
  setStatus('');
  renderSessionList();
  messageInput.focus();
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

newSessionBtn.addEventListener('click', startNewChat);

settingsBtn.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
// Click outside the inner content (the dialog backdrop) closes the modal.
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

templateSelect.addEventListener('change', () => selectTemplate(templateSelect.value));
saveTemplateBtn.addEventListener('click', saveTemplateOverwrite);
newTemplateBtn.addEventListener('click', saveTemplateAsNew);

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

  renderEditor();
  await Promise.all([loadModels(), loadTemplates(), loadSessions()]);
  messageInput.focus();
})();
