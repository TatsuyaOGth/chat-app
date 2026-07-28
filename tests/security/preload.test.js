'use strict';

const mockExposures = new Map();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();
const mockInvoke = jest.fn();
const mockSend = jest.fn();

jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name, api) => {
      mockExposures.set(name, api);
    },
  },
  ipcRenderer: {
    on: mockOn,
    removeListener: mockRemoveListener,
    invoke: mockInvoke,
    send: mockSend,
  },
}));

describe('preload bridge', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExposures.clear();
    mockOn.mockClear();
    mockRemoveListener.mockClear();
    mockInvoke.mockClear();
    mockSend.mockClear();
    require('../../src/preload');
  });

  test('想定した API だけを公開する', () => {
    expect(Array.from(mockExposures.keys()).sort()).toEqual(['app', 'ollama', 'presets', 'sessions', 'tavily']);
  });

  test('ollama API が正しい IPC チャネルへ転送する', () => {
    const ollama = mockExposures.get('ollama');

    ollama.getModels();
    ollama.checkLoaded('llama3');
    ollama.getConfig();
    ollama.setConfig('http://192.168.1.50:11434');
    ollama.testConnection('http://192.168.1.50:11434');
    ollama.chat('req-1', { model: 'llama3', messages: [] });
    ollama.chat('req-2', { model: 'qwen3', messages: [], reasoningEnabled: false });
    ollama.cancel('req-1');

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'ollama:get-models');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'ollama:check-loaded', 'llama3');
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'ollama:get-config');
    expect(mockInvoke).toHaveBeenNthCalledWith(4, 'ollama:set-config', 'http://192.168.1.50:11434');
    expect(mockInvoke).toHaveBeenNthCalledWith(5, 'ollama:test-connection', 'http://192.168.1.50:11434');
    expect(mockSend).toHaveBeenNthCalledWith(1, 'ollama:chat', {
      requestId: 'req-1',
      model: 'llama3',
      messages: [],
      system: undefined,
      options: undefined,
      webSearchEnabled: undefined,
      reasoningEnabled: undefined,
    });
    expect(mockSend).toHaveBeenNthCalledWith(2, 'ollama:chat', {
      requestId: 'req-2',
      model: 'qwen3',
      messages: [],
      system: undefined,
      options: undefined,
      webSearchEnabled: undefined,
      reasoningEnabled: false,
    });
    expect(mockSend).toHaveBeenNthCalledWith(3, 'ollama:chat:cancel', { requestId: 'req-1' });
  });

  test('tavily API が正しい IPC チャネルへ転送する', () => {
    const tavily = mockExposures.get('tavily');

    tavily.getConfigStatus();
    tavily.saveApiKey('tvly-test-key');
    tavily.deleteApiKey();

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'tavily:get-config-status');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'tavily:save-api-key', 'tvly-test-key');
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'tavily:delete-api-key');
  });

  test('stream listener の unsubscribe が removeListener を呼ぶ', () => {
    const ollama = mockExposures.get('ollama');
    const callback = jest.fn();

    const unsubscribe = ollama.onChatChunk(callback);

    expect(mockOn).toHaveBeenCalledWith('ollama:chat:chunk', expect.any(Function));

    const handler = mockOn.mock.calls[0][1];
    handler({}, { requestId: 'req-1', content: 'hello', done: false });

    expect(callback).toHaveBeenCalledWith({ requestId: 'req-1', content: 'hello', done: false });

    unsubscribe();

    expect(mockRemoveListener).toHaveBeenCalledWith('ollama:chat:chunk', handler);
  });
});