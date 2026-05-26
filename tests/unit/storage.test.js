'use strict';

const storeState = {};

jest.mock('electron-store', () => class MockStore {
  constructor({ name, defaults }) {
    this.name = name;
    if (!storeState[name]) {
      storeState[name] = JSON.parse(JSON.stringify(defaults));
    }
  }

  get(key) {
    return storeState[this.name][key];
  }

  set(key, value) {
    storeState[this.name][key] = value;
  }

  static __reset() {
    for (const key of Object.keys(storeState)) delete storeState[key];
  }

  static __seed(name, value) {
    storeState[name] = JSON.parse(JSON.stringify(value));
  }
});

describe('storage', () => {
  let storage;
  let MockStore;

  beforeEach(() => {
    jest.resetModules();
    MockStore = require('electron-store');
    MockStore.__reset();
  });

  test('legacy templates が presets に migrate される', () => {
    MockStore.__seed('templates', {
      items: [{ id: 'legacy-1', name: 'Legacy', params: { temperature: 0.7 } }],
    });

    storage = require('../../src/storage');

    expect(storage.presets.list()).toEqual([
      { id: 'legacy-1', name: 'Legacy', params: { temperature: 0.7 } },
    ]);
  });

  test('preset を create update reorder delete できる', () => {
    storage = require('../../src/storage');

    const first = storage.presets.create({ name: 'A', params: { temperature: 0.1 } });
    const second = storage.presets.create({ name: 'B', params: { temperature: 0.2 } });
    const updated = storage.presets.update(first.id, { name: 'A2', params: { temperature: 0.3 } });
    const reordered = storage.presets.reorder([second.id, first.id]);

    expect(updated.name).toBe('A2');
    expect(reordered.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(storage.presets.delete(first.id)).toBe(true);
    expect(storage.presets.get(first.id)).toBeNull();
  });

  test('session を create append update delete できる', () => {
    storage = require('../../src/storage');

    const session = storage.sessions.create({ title: 'Chat' });
    const appended = storage.sessions.appendMessage(session.id, { role: 'user', content: 'hello' });
    const updated = storage.sessions.update(session.id, { title: 'Chat 2' });

    expect(appended.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(updated.title).toBe('Chat 2');
    expect(storage.sessions.delete(session.id)).toBe(true);
    expect(storage.sessions.get(session.id)).toBeNull();
  });
});