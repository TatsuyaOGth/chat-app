'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc ollama:chat:cancel', () => {
  test('in-flight request を中断して cancelled=true を返す', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    mockOllamaChatStream.mockImplementation((payload, _onChunk, _onDone, _onError, options) => {
      options.activeRequests.set(payload.requestId, jest.fn(() => true));
    });

    mockEvents.get('ollama:chat')({ sender }, {
      requestId: 'req-cancel',
      model: 'llama3',
      messages: [],
    });
    mockEvents.get('ollama:chat:cancel')({ sender }, { requestId: 'req-cancel' });

    expect(sender.send).toHaveBeenCalledWith('ollama:chat:error', {
      requestId: 'req-cancel',
      error: 'キャンセルされました',
      cancelled: true,
    });
  });

  test('abort 対象が無いときは何も送信しない', () => {
    const { mockEvents } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    mockEvents.get('ollama:chat:cancel')({ sender }, { requestId: 'missing' });

    expect(sender.send).not.toHaveBeenCalled();
  });
});