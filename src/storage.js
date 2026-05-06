'use strict';

const Store = require('electron-store');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------
//
// Two separate files in the OS userData folder:
//   templates.json — parameter presets the user can pick from / edit
//   history.json   — chat sessions with per-message paramsSnapshot
//
// Each store keeps its records as an ordered array under `items` so the user
// can drag-and-drop reorder them in the settings modal (phase 4).

const templatesStore = new Store({
  name: 'templates',
  defaults: { items: [] },
});

const sessionsStore = new Store({
  name: 'history',
  defaults: { items: [] },
});

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function listTemplates() {
  return templatesStore.get('items');
}

function getTemplate(id) {
  return listTemplates().find((t) => t.id === id) || null;
}

function createTemplate({ name, params }) {
  const items = listTemplates();
  const template = {
    id: newId(),
    name: name || 'Untitled',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    params: params || {},
  };
  templatesStore.set('items', [...items, template]);
  return template;
}

function updateTemplate(id, patch) {
  const items = listTemplates();
  const idx = items.findIndex((t) => t.id === id);
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
  templatesStore.set('items', next);
  return updated;
}

function deleteTemplate(id) {
  const items = listTemplates();
  templatesStore.set('items', items.filter((t) => t.id !== id));
  return true;
}

function reorderTemplates(orderedIds) {
  const items = listTemplates();
  const byId = new Map(items.map((t) => [t.id, t]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  // Append any items that were not included in the order list (defensive)
  for (const t of items) {
    if (!orderedIds.includes(t.id)) reordered.push(t);
  }
  templatesStore.set('items', reordered);
  return reordered;
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

function createSession({ templateId = null, title = '', messages = [] } = {}) {
  const items = listSessions();
  const session = {
    id: newId(),
    templateId,
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
  templates: {
    list: listTemplates,
    get: getTemplate,
    create: createTemplate,
    update: updateTemplate,
    delete: deleteTemplate,
    reorder: reorderTemplates,
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
