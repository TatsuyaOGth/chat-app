'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Full conversation history sent to Ollama on each request. */
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

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const messagesEl = document.getElementById('messages');
const inputForm = document.getElementById('input-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const statusBar = document.getElementById('status-bar');
const newSessionBtn = document.getElementById('new-session-btn');

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
  return content;
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

  messages.push({ role: 'user', content: text });
  appendMessage('user', text);
  messageInput.value = '';
  updateSendButton();

  const assistantContent = appendMessage('assistant', '');
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

  function finish() {
    unsubChunk();
    unsubError();
    isGenerating = false;
    if (done && responseText) {
      messages.push({ role: 'assistant', content: responseText });
      setStatus('');
    }
    updateSendButton();
  }

  window.ollama.chat(requestId, { model, messages, system, options });
}

// ---------------------------------------------------------------------------
// New chat
// ---------------------------------------------------------------------------

function startNewChat() {
  messages = [];
  messagesEl.innerHTML = '';
  setStatus('');
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
  await Promise.all([loadModels(), loadTemplates()]);
  messageInput.focus();
})();
