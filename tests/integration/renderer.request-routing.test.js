'use strict';

const { subscribeGenerationRouting } = require('../../src/renderer/request-routing');

function createOllamaMock() {
  let chunkListener;
  let errorListener;

  const unsubChunkRaw = jest.fn();
  const unsubErrorRaw = jest.fn();

  return {
    ollama: {
      onChatChunk: jest.fn((listener) => {
        chunkListener = listener;
        return unsubChunkRaw;
      }),
      onChatError: jest.fn((listener) => {
        errorListener = listener;
        return unsubErrorRaw;
      }),
    },
    emitChunk: (data) => chunkListener(data),
    emitError: (data) => errorListener(data),
    unsubChunkRaw,
    unsubErrorRaw,
  };
}

describe('renderer request routing', () => {
  test('requestId 一致の chunk だけを転送する', () => {
    const mock = createOllamaMock();
    const onChunk = jest.fn();

    subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-1',
      onChunk,
      onError: jest.fn(),
    });

    mock.emitChunk({ requestId: 'other', content: 'X', done: false });
    mock.emitChunk({ requestId: 'req-1', content: 'A', done: false });

    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith({ requestId: 'req-1', content: 'A', done: false });
  });

  test('requestId 一致の error だけを転送する', () => {
    const mock = createOllamaMock();
    const onError = jest.fn();

    subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-2',
      onChunk: jest.fn(),
      onError,
    });

    mock.emitError({ requestId: 'other', error: 'ignore', cancelled: false });
    mock.emitError({ requestId: 'req-2', error: 'HTTP 503: busy', cancelled: false });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith({ requestId: 'req-2', error: 'HTTP 503: busy', cancelled: false });
  });

  test('unsubscribeAll は両 listener を一度だけ解除する', () => {
    const mock = createOllamaMock();

    const routing = subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-3',
      onChunk: jest.fn(),
      onError: jest.fn(),
    });

    routing.unsubscribeAll();
    routing.unsubscribeAll();

    expect(mock.unsubChunkRaw).toHaveBeenCalledTimes(1);
    expect(mock.unsubErrorRaw).toHaveBeenCalledTimes(1);
  });
});