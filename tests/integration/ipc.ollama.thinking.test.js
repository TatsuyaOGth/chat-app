'use strict';

const { loadMainWithMocks } = require('./helpers/load-main');

describe('ipc ollama:chat — thinking イベント', () => {
  test('onThinking コールバック経由で ollama:chat:thinking を renderer へ送信する', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    // ollamaChatStream の第 6 引数 (onThinking) を呼び出す実装をシミュレート
    mockOllamaChatStream.mockImplementation(
      (_payload, _onChunk, _onDone, _onError, _deps, onThinking) => {
        onThinking('reasoning step 1');
        onThinking('reasoning step 2');
      },
    );

    mockEvents.get('ollama:chat')({ sender }, {
      requestId: 'req-t1',
      model: 'deepseek-r1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    const thinkingCalls = sender.send.mock.calls
      .filter(([channel]) => channel === 'ollama:chat:thinking')
      .map(([, data]) => data);

    expect(thinkingCalls).toEqual([
      { requestId: 'req-t1', thinking: 'reasoning step 1' },
      { requestId: 'req-t1', thinking: 'reasoning step 2' },
    ]);
  });

  test('onThinking は ollamaChatStream の第 6 引数として渡される', () => {
    const { mockEvents, mockOllamaChatStream } = loadMainWithMocks();
    const sender = {
      isDestroyed: jest.fn(() => false),
      send: jest.fn(),
    };

    mockEvents.get('ollama:chat')({ sender }, {
      requestId: 'req-t2',
      model: 'llama3',
      messages: [],
    });

    expect(mockOllamaChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-t2' }),
      expect.any(Function), // onChunk
      expect.any(Function), // onDone
      expect.any(Function), // onError
      expect.any(Object),   // deps
      expect.any(Function), // onThinking ← 新規
    );
  });
});
