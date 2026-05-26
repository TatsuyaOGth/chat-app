'use strict';

function loadMainWithMocks() {
  jest.resetModules();

  const mockHandles = new Map();
  const mockEvents = new Map();
  const mockOllamaRequest = jest.fn();
  const mockOllamaChatStream = jest.fn();
  const mockStorage = {
    presets: {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      reorder: jest.fn(),
    },
    sessions: {
      list: jest.fn(),
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      appendMessage: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockApp = {
    whenReady: jest.fn(() => ({ then: jest.fn() })),
    on: jest.fn(),
    quit: jest.fn(),
  };

  const MockBrowserWindow = jest.fn(() => ({
    loadFile: jest.fn(),
  }));
  MockBrowserWindow.fromWebContents = jest.fn(() => ({ id: 'win-1' }));
  MockBrowserWindow.getAllWindows = jest.fn(() => []);

  const mockDialog = {
    showMessageBox: jest.fn(),
  };

  jest.doMock('electron', () => ({
    app: mockApp,
    BrowserWindow: MockBrowserWindow,
    ipcMain: {
      handle: jest.fn((channel, handler) => {
        mockHandles.set(channel, handler);
      }),
      on: jest.fn((channel, handler) => {
        mockEvents.set(channel, handler);
      }),
    },
    dialog: mockDialog,
  }));

  jest.doMock('../../../src/storage', () => mockStorage);
  jest.doMock('../../../src/ollama', () => ({
    ollamaRequest: mockOllamaRequest,
    ollamaChatStream: mockOllamaChatStream,
  }));

  require('../../../src/main');

  return {
    mockHandles,
    mockEvents,
    mockOllamaRequest,
    mockOllamaChatStream,
    mockStorage,
    mockApp,
    MockBrowserWindow,
    mockDialog,
  };
}

module.exports = {
  loadMainWithMocks,
};