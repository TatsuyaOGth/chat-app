'use strict';

const { subscribeGenerationRouting } = require('../../src/renderer/request-routing');

function createOllamaMock() {
  let chunkListener;
  let errorListener;
  let thinkingListener;

  const unsubChunkRaw = jest.fn();
  const unsubErrorRaw = jest.fn();
  const unsubThinkingRaw = jest.fn();

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
      onChatThinking: jest.fn((listener) => {
        thinkingListener = listener;
        return unsubThinkingRaw;
      }),
    },
    emitChunk: (data) => chunkListener(data),
    emitError: (data) => errorListener(data),
    emitThinking: (data) => thinkingListener(data),
    unsubChunkRaw,
    unsubErrorRaw,
    unsubThinkingRaw,
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

  test('requestId 一致の thinking だけを転送する', () => {
    const mock = createOllamaMock();
    const onThinking = jest.fn();

    subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-4',
      onChunk: jest.fn(),
      onError: jest.fn(),
      onThinking,
    });

    mock.emitThinking({ requestId: 'other', thinking: 'ignore' });
    mock.emitThinking({ requestId: 'req-4', thinking: 'step 1' });
    mock.emitThinking({ requestId: 'req-4', thinking: 'step 2' });

    expect(onThinking).toHaveBeenCalledTimes(2);
    expect(onThinking).toHaveBeenNthCalledWith(1, { requestId: 'req-4', thinking: 'step 1' });
    expect(onThinking).toHaveBeenNthCalledWith(2, { requestId: 'req-4', thinking: 'step 2' });
  });

  test('onThinking 未指定でも ollama.onChatThinking はスキップされる', () => {
    const mock = createOllamaMock();

    subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-5',
      onChunk: jest.fn(),
      onError: jest.fn(),
      // onThinking を渡さない
    });

    expect(mock.ollama.onChatThinking).not.toHaveBeenCalled();
  });

  test('unsubscribeAll は全 listener を一度だけ解除する（thinking 含む）', () => {
    const mock = createOllamaMock();

    const routing = subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-3',
      onChunk: jest.fn(),
      onError: jest.fn(),
      onThinking: jest.fn(),
    });

    routing.unsubscribeAll();
    routing.unsubscribeAll();

    expect(mock.unsubChunkRaw).toHaveBeenCalledTimes(1);
    expect(mock.unsubErrorRaw).toHaveBeenCalledTimes(1);
    expect(mock.unsubThinkingRaw).toHaveBeenCalledTimes(1);
  });

  test('unsubThinking を呼んだ後に unsubscribeAll を呼んでも二重解除しない', () => {
    const mock = createOllamaMock();

    const routing = subscribeGenerationRouting({
      ollama: mock.ollama,
      requestId: 'req-6',
      onChunk: jest.fn(),
      onError: jest.fn(),
      onThinking: jest.fn(),
    });

    // unsubThinking を個別に呼ぶと unsubThinkingRaw が 1 回呼ばれる
    routing.unsubThinking();
    expect(mock.unsubThinkingRaw).toHaveBeenCalledTimes(1);

    // unsubscribeAll を 2 回呼んでも 2 回目は unsubscribed フラグで止まる
    routing.unsubscribeAll();
    routing.unsubscribeAll();

    // unsubThinkingRaw は unsubThinking() で 1 回 + unsubscribeAll() で 1 回 = 2 回
    expect(mock.unsubThinkingRaw).toHaveBeenCalledTimes(2);
    // 2 回目の unsubscribeAll() では呼ばれない（フラグで止まる）
    expect(mock.unsubChunkRaw).toHaveBeenCalledTimes(1);
  });
});