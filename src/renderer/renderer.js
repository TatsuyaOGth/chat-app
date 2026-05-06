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

/** All saved templates, in display order. */
let templates = [];

/** ID of the currently selected template, or null when editing unsaved values. */
let activeTemplateId = null;

/**
 * Working copy of the parameter values currently in the editor.
 * Edits modify this object only; the saved template stays untouched until
 * the user clicks "上書き保存" or "新規テンプレート".
 */
let workingParams = window.Params.emptyParams();

/** All sessions, in storage order (newest first). */
let sessions = [];

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

const templateSelect = document.getElementById('template-select');
const paramEditor = document.getElementById('param-editor');
const saveTemplateBtn = document.getElementById('save-template-btn');
const newTemplateBtn = document.getElementById('new-template-btn');

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
  templates = await window.templates.list();
  renderTemplateSelect();
}

function renderTemplateSelect() {
  templateSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '（新規 / 未保存）';
  templateSelect.appendChild(placeholder);

  for (const t of templates) {
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
    const t = templates.find((tt) => tt.id === activeTemplateId);
    workingParams = { ...window.Params.emptyParams(), ...(t?.params || {}) };
  } else {
    workingParams = window.Params.emptyParams();
  }
  renderTemplateSelect();
  renderEditor();
  updateSendButton();
}

async function saveTemplateOverwrite() {
  if (!activeTemplateId) return;
  const updated = await window.templates.update(activeTemplateId, {
    params: { ...workingParams },
  });
  if (!updated) return;
  await loadTemplates();
  renderTemplateSelect();
  setStatus(`テンプレート「${updated.name}」を更新しました`);
}

async function saveTemplateAsNew() {
  const name = (window.prompt('テンプレート名を入力してください', '新しいテンプレート') || '').trim();
  if (!name) return;
  const created = await window.templates.create({
    name,
    params: { ...workingParams },
  });
  activeTemplateId = created.id;
  await loadTemplates();
  renderTemplateSelect();
  setStatus(`テンプレート「${name}」を作成しました`);
}

// ---------------------------------------------------------------------------
// Parameter editor
// ---------------------------------------------------------------------------

function renderEditor() {
  window.Params.renderParamEditor(paramEditor, workingParams, {
    modelOptions,
    onChange: (key, value) => {
      workingParams = { ...workingParams, [key]: value };
      renderEditor();
      updateSendButton();
    },
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function loadSessions() {
  sessions = await window.sessions.list();
  renderSessionList();
}

function renderSessionList() {
  sessionListEl.innerHTML = '';

  if (sessions.length === 0) {
    const hint = document.createElement('p');
    hint.classList.add('hint');
    hint.textContent = '会話を始めると履歴がここに表示されます';
    sessionListEl.appendChild(hint);
    return;
  }

  for (const s of sessions) {
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
  if (!window.confirm('このセッションを削除しますか？')) return;
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
  content.textContent = initialText;

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
      assistantContent.textContent = responseText;
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
  renderEditor();
  await Promise.all([loadModels(), loadTemplates(), loadSessions()]);
  messageInput.focus();
})();
