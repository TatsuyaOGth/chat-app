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

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const modelSelect = document.getElementById('model-select');
const refreshModelsBtn = document.getElementById('refresh-models-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const messagesEl = document.getElementById('messages');
const inputForm = document.getElementById('input-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const statusBar = document.getElementById('status-bar');

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

async function loadModels() {
  setStatus('Loading models…');
  modelSelect.innerHTML = '<option value="">Loading…</option>';
  modelSelect.disabled = true;

  try {
    const { models, error } = await window.ollama.getModels();

    if (error && models.length === 0) {
      setStatus(`Could not reach Ollama: ${error}`, 'error');
      modelSelect.innerHTML = '<option value="">No models found</option>';
      return;
    }

    modelSelect.innerHTML = '';
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models available</option>';
      setStatus('No Ollama models found. Run "ollama pull <model>" to add one.', 'warn');
    } else {
      for (const name of models) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        modelSelect.appendChild(opt);
      }
      setStatus('');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    modelSelect.innerHTML = '<option value="">Error loading models</option>';
  } finally {
    modelSelect.disabled = false;
    updateSendButton();
  }
}

// ---------------------------------------------------------------------------
// Chat rendering
// ---------------------------------------------------------------------------

/**
 * Append a message bubble to the chat area.
 * @param {'user'|'assistant'|'system'} role
 * @param {string} initialText
 * @returns {HTMLElement} The content element (so it can be updated while streaming).
 */
function appendMessage(role, initialText) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('message', `message--${role}`);

  const label = document.createElement('span');
  label.classList.add('message__role');
  label.textContent = role === 'user' ? 'You' : 'Assistant';

  const content = document.createElement('div');
  content.classList.add('message__content');
  content.textContent = initialText;

  wrapper.appendChild(label);
  wrapper.appendChild(content);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return content;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function setStatus(text, level = 'info') {
  statusBar.textContent = text;
  statusBar.className = `status-bar status-bar--${level}`;
}

// ---------------------------------------------------------------------------
// Send / receive
// ---------------------------------------------------------------------------

function updateSendButton() {
  const hasText = messageInput.value.trim().length > 0;
  const hasModel = modelSelect.value !== '';
  sendBtn.disabled = !hasText || !hasModel || isGenerating;
}

async function sendMessage() {
  const text = messageInput.value.trim();
  const model = modelSelect.value;
  if (!text || !model || isGenerating) return;

  // Add user message to history and render it
  messages.push({ role: 'user', content: text });
  appendMessage('user', text);
  messageInput.value = '';
  updateSendButton();

  // Prepare assistant bubble
  const assistantContent = appendMessage('assistant', '');
  isGenerating = true;
  sendBtn.disabled = true;
  setStatus('Generating…');

  const requestId = String(++requestCounter);
  let responseText = '';
  let done = false;

  // Subscribe to streamed chunks for this request
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
    assistantContent.textContent = `[Error: ${error}]`;
    assistantContent.classList.add('message__content--error');
    setStatus(`Error: ${error}`, 'error');
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

  window.ollama.chat(requestId, { model, messages });
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

refreshModelsBtn.addEventListener('click', loadModels);
newChatBtn.addEventListener('click', startNewChat);

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

loadModels();
messageInput.focus();
