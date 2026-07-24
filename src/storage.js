'use strict';

const Store = require('electron-store');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
//
// Two separate files in the OS userData folder:
//   presets.json  — parameter presets the user can pick from / edit
//   history.json   — chat sessions with per-message paramsSnapshot
//
// Each store keeps its records as an ordered array under `items` so the user
// can drag-and-drop reorder them in the settings modal (phase 4).

const presetsStore = new Store({
  name: 'presets',
  defaults: { items: [] },
});

const sessionsStore = new Store({
  name: 'history',
  defaults: { items: [] },
});

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

const ollamaConfigStore = new Store({
  name: 'ollama-config',
  defaults: { baseUrl: OLLAMA_DEFAULT_BASE_URL },
});

// Migrate from the old templates store name.
const legacyTemplatesStore = new Store({
  name: 'templates',
  defaults: { items: [] },
});
if (presetsStore.get('items').length === 0) {
  const legacyItems = legacyTemplatesStore.get('items');
  if (legacyItems.length > 0) {
    presetsStore.set('items', legacyItems);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function listPresets() {
  return presetsStore.get('items');
}

function getPreset(id) {
  return listPresets().find((p) => p.id === id) || null;
}

function createPreset({ name, params }) {
  const items = listPresets();
  const preset = {
    id: newId(),
    name: name || 'Untitled',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    params: params || {},
  };
  presetsStore.set('items', [...items, preset]);
  return preset;
}

function updatePreset(id, patch) {
  const items = listPresets();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const updated = {
    ...items[idx],
    ...patch,
    id: items[idx].id,
    createdAt: items[idx].createdAt,
    updatedAt: nowIso(),
  };
  const next = [...items];
  next[idx] = updated;
  presetsStore.set('items', next);
  return updated;
}

function deletePreset(id) {
  const items = listPresets();
  presetsStore.set('items', items.filter((p) => p.id !== id));
  return true;
}

function reorderPresets(orderedIds) {
  const items = listPresets();
  const byId = new Map(items.map((p) => [p.id, p]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Append any items that were not included in the order list (defensive)
  for (const p of items) {
    if (!orderedIds.includes(p.id)) reordered.push(p);
  }
  presetsStore.set('items', reordered);
  return reordered;
}

// ---------------------------------------------------------------------------
// Ollama connection config
// ---------------------------------------------------------------------------

function getOllamaConfig() {
  return { baseUrl: ollamaConfigStore.get('baseUrl') };
}

function setOllamaConfig(baseUrl) {
  const trimmed = String(baseUrl || '').trim();
  ollamaConfigStore.set('baseUrl', trimmed || OLLAMA_DEFAULT_BASE_URL);
  return getOllamaConfig();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function listSessions() {
  return sessionsStore.get('items');
}

function getSession(id) {
  return listSessions().find((s) => s.id === id) || null;
}

function createSession({ presetId = null, title = '', messages = [] } = {}) {
  const items = listSessions();
  const session = {
    id: newId(),
    presetId,
    title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages,
  };
  sessionsStore.set('items', [session, ...items]);
  return session;
}

function updateSession(id, patch) {
  const items = listSessions();
  const idx = items.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const updated = {
    ...items[idx],
    ...patch,
    id: items[idx].id,
    createdAt: items[idx].createdAt,
    updatedAt: nowIso(),
  };
  const next = [...items];
  next[idx] = updated;
  sessionsStore.set('items', next);
  return updated;
}

/**
 * Append a message to a session. For assistant messages, callers should
 * include `paramsSnapshot` so the exact settings used for that response
 * are preserved alongside the content.
 */
function appendMessage(sessionId, message) {
  const session = getSession(sessionId);
  if (!session) return null;
  const messages = [...session.messages, message];
  return updateSession(sessionId, { messages });
}

function deleteSession(id) {
  const items = listSessions();
  sessionsStore.set('items', items.filter((s) => s.id !== id));
  return true;
}

module.exports = {
  presets: {
    list: listPresets,
    get: getPreset,
    create: createPreset,
    update: updatePreset,
    delete: deletePreset,
    reorder: reorderPresets,
  },
  ollamaConfig: {
    get: getOllamaConfig,
    set: setOllamaConfig,
  },
  sessions: {
    list: listSessions,
    get: getSession,
    create: createSession,
    update: updateSession,
    appendMessage,
    delete: deleteSession,
  },
};
