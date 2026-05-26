'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc ollama:chat', () => {
  test('stream の chunk と done を renderer へ転送する', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };
    const payload = {
      requestId: 'req-1',
      model: 'llama3',
      messages: [{ role: 'user', content: 'hello' }],
      system: 'helpful',
      options: { temperature: 0.7 },
    };

    mockOllamaChatStream.mockImplementation((streamPayload, onChunk, onDone) => {
      onChunk('A');
      onChunk('B');
      onDone();
    });

    mockEvents.get('ollama:chat')({ sender }, payload);

    expect(mockOllamaChatStream).toHaveBeenCalledWith(
      payload,
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ activeRequests: expect.any(Map) }),
    );
    expect(sender.send).toHaveBeenNthCalledWith(1, 'ollama:chat:chunk', {
      requestId: 'req-1',
      content: 'A',
      done: false,
    });
    expect(sender.send).toHaveBeenNthCalledWith(2, 'ollama:chat:chunk', {
      requestId: 'req-1',
      content: 'B',
      done: false,
    });
    expect(sender.send).toHaveBeenNthCalledWith(3, 'ollama:chat:chunk', {
      requestId: 'req-1',
      content: '',
      done: true,
    });
  });

  test('stream error を renderer の error イベントへ転送する', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    mockOllamaChatStream.mockImplementation((_payload, _onChunk, _onDone, onError) => {
      onError(new Error('HTTP 503: busy'));
    });

    mockEvents.get('ollama:chat')({ sender }, {
      requestId: 'req-2',
      model: 'llama3',
      messages: [],
    });

    expect(sender.send).toHaveBeenCalledWith('ollama:chat:error', {
      requestId: 'req-2',
      error: 'HTTP 503: busy',
    });
  });
});